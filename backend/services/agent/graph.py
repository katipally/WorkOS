"""
LangGraph agent graph — orchestrates tool calling, planning, and approval gates.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Literal, Union

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode

from services.agent.state import AgentState
from services.agent.tools import AGENT_TOOLS, get_tools_for_context
from services.agent.prompts import build_system_prompt
from services.agent.config import (
    LLM_TIMEOUT_SECONDS,
    MAX_TOOL_LOOPS,
    APPROVAL_REQUIRED_TOOLS,
    COMPACTION_THRESHOLD,
    COMPACTION_KEEP_RECENT,
    COMPACTION_CHAR_LIMIT,
    COMPACTION_INPUT_CAP,
    COMPACTION_TEMPERATURE,
    RAG_DEFAULT_TOP_K,
    RAG_TAB_TOP_K,
    RAG_MIN_PER_SOURCE,
    RAG_CONTEXT_SNIPPET_LEN,
    RAG_MAX_SNIPPETS,
)
from services.ai_service import get_llm
from services.rag_service import search_documents

log = logging.getLogger(__name__)


async def _get_pinned_messages(session_id: str) -> list[str]:
    """Fetch pinned messages for a session."""
    from db.connection import get_pool

    pool = get_pool()
    rows = await pool.fetch(
        """
        SELECT content FROM chat_messages
        WHERE session_id = $1 AND pinned = TRUE
        ORDER BY created_at
        """,
        session_id,
    )
    return [r["content"] for r in rows]


# ─── Node: RAG Retrieval ─────────────────────────────────────────────────────

async def rag_retrieval_node(state: AgentState) -> dict:
    """Retrieve relevant context from RAG before calling the LLM.

    Priority:
    1. If user has @-mentioned specific sources → retrieve from each mentioned source
    2. Else if scope == "tab" → filter to the active tab's source type
    3. Else (whole workspace) → unfiltered retrieval across all sources
    """
    # Get the last user message
    last_user_msg = ""
    for msg in reversed(state.messages):
        if isinstance(msg, HumanMessage):
            last_user_msg = msg.content
            break

    if not last_user_msg:
        return {"rag_context": []}

    # Map mention names → source types used in the data_index / document_chunks tables
    mention_to_source = {
        "slack": "slack_message",
        "github": "github_issue",
        "meetings": "meeting",
    }
    tab_to_source = {
        "slack": "slack_message",
        "github": "github_issue",
        "meetings": "meeting",
    }

    try:
        if state.context_mentions:
            # Multi-source retrieval balanced across mentioned sources
            all_results: list[dict] = []
            per_source_k = max(RAG_MIN_PER_SOURCE, RAG_DEFAULT_TOP_K // len(state.context_mentions))
            for mention in state.context_mentions:
                src = mention_to_source.get(mention)
                results = await search_documents(last_user_msg, top_k=per_source_k, source_filter=src)
                all_results.extend(results)
            # Deduplicate by content and sort by score
            seen: set[str] = set()
            deduped = []
            for r in sorted(all_results, key=lambda x: x.get("rerank_score", x.get("score", 0)), reverse=True):
                key = r.get("content", "")[:100]
                if key not in seen:
                    seen.add(key)
                    deduped.append(r)
            return {"rag_context": deduped[:RAG_DEFAULT_TOP_K]}

        elif state.scope == "tab":
            source_filter = tab_to_source.get(state.focused_tab)
            results = await search_documents(last_user_msg, top_k=RAG_TAB_TOP_K, source_filter=source_filter)
            return {"rag_context": results}

        else:
            results = await search_documents(last_user_msg, top_k=RAG_DEFAULT_TOP_K)
            return {"rag_context": results}

    except Exception as e:
        log.warning("RAG retrieval failed: %s", e)
        return {"rag_context": []}


# ─── Node: LLM Call ──────────────────────────────────────────────────────────

async def llm_node(state: AgentState) -> dict:
    """Call the LLM with tools bound, including RAG context."""
    # Build system prompt
    pinned = []
    if state.session_id:
        try:
            from uuid import UUID
            UUID(state.session_id)
            pinned = await _get_pinned_messages(state.session_id)
        except (ValueError, Exception):
            pass

    system_prompt = build_system_prompt(
        focused_tab=state.focused_tab,
        scope=state.scope,
        pinned_messages=pinned,
        connected_providers=state.connected_providers or None,
        selected_repo=state.selected_repo,
        selected_channel=state.selected_channel,
        selected_channel_name=state.selected_channel_name,
    )

    # Add RAG context to system prompt if available
    if state.rag_context:
        rag_text = "\n\n## Relevant Context (from indexed documents/data)\n"
        for i, ctx in enumerate(state.rag_context[:RAG_MAX_SNIPPETS], 1):
            source = ctx.get("source", "unknown")
            title = ctx.get("title", ctx.get("filename", ""))
            content = ctx.get("content", "")[:RAG_CONTEXT_SNIPPET_LEN]
            rag_text += f"\n### [{i}] {source}: {title}\n{content}\n"
        system_prompt += rag_text

    # Smart compaction: summarize old messages if conversation is long
    conv_messages = state.messages
    compaction_performed = False
    if len(conv_messages) > COMPACTION_THRESHOLD:
        try:
            summary_llm = await get_llm("ai", streaming=False, temperature=COMPACTION_TEMPERATURE)

            # Find a safe split point: never break inside an
            # AIMessage(tool_calls) → ToolMessage sequence.
            split_idx = max(0, len(conv_messages) - COMPACTION_KEEP_RECENT)
            # Walk the split point forward until we're not inside a
            # tool_call/ToolMessage pair.
            while split_idx < len(conv_messages):
                msg = conv_messages[split_idx]
                if isinstance(msg, ToolMessage):
                    split_idx += 1  # skip orphan ToolMessages
                elif isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
                    split_idx += 1  # skip AIMessage that has tool_calls pending
                else:
                    break

            if split_idx <= 0 or split_idx >= len(conv_messages):
                # Can't safely split — skip compaction
                raise ValueError("No safe split point found")

            old_msgs = conv_messages[:split_idx]
            recent_msgs = conv_messages[split_idx:]
            old_text = "\n".join(
                f"{getattr(m, 'type', 'unknown')}: {(m.content if isinstance(m.content, str) else str(m.content))[:COMPACTION_CHAR_LIMIT]}"
                for m in old_msgs if hasattr(m, 'content') and m.content
            )
            summary_resp = await summary_llm.ainvoke([
                SystemMessage(content="Summarize the following conversation history concisely. Preserve key decisions, action items, and context."),
                HumanMessage(content=old_text[:COMPACTION_INPUT_CAP]),
            ])
            summary_content = summary_resp.content
            if isinstance(summary_content, list):
                summary_content = " ".join(str(x) for x in summary_content)
            system_prompt += f"\n\n## Summary of Earlier Conversation\n{summary_content}\n"
            conv_messages = recent_msgs
            compaction_performed = True
        except Exception as e:
            log.warning("Smart compaction failed: %s", e)

    # Prepare messages with system prompt
    messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
    messages.extend(conv_messages)

    # Get LLM with tools (streaming=True enables real token-by-token streaming
    # when the graph is invoked with stream_mode including "messages")
    # temperature=None → reads from DB ai_temperature setting
    llm = await get_llm("ai", streaming=True, temperature=None)

    # Use scope-filtered tools from state (set by caller), fallback to all tools
    tools = state.active_tools if state.active_tools else AGENT_TOOLS
    llm_with_tools = llm.bind_tools(tools)

    try:
        response = await asyncio.wait_for(
            llm_with_tools.ainvoke(messages),
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning("LLM call timed out after %ds", LLM_TIMEOUT_SECONDS)
        response = AIMessage(content="I'm sorry, the request took too long. Please try again with a simpler question.")
    except Exception as e:
        log.exception("LLM invocation error")
        response = AIMessage(content=f"An error occurred while processing your request: {e}")

    # ── Normalise response.content ────────────────────────────────────
    # Some providers (Ollama) may return content as a list of dicts
    # instead of a plain string.  Flatten it to avoid downstream crashes.
    if isinstance(response, AIMessage):
        if isinstance(response.content, list):
            parts = []
            for item in response.content:
                if isinstance(item, dict):
                    parts.append(item.get("text", str(item)))
                elif isinstance(item, str):
                    parts.append(item)
                else:
                    parts.append(str(item))
            response.content = "".join(parts)
        # ── Ensure all tool_calls have an "id" field ─────────────────
        # Ollama / some providers may omit the tool_call id, which breaks
        # the ToolMessage → tool_call_id mapping downstream.
        import uuid as _uuid
        if getattr(response, "tool_calls", None):
            for tc in response.tool_calls:
                if not tc.get("id"):
                    tc["id"] = f"call_{_uuid.uuid4().hex[:12]}"
    # Generate plan steps for multi-tool calls
    plan_steps = []
    thoughts = []

    if compaction_performed:
        thoughts.append("Summarized earlier conversation to stay within context limits")

    # ── Capture real LLM reasoning tokens (OpenAI o1/o3/o4, Anthropic) ───
    if isinstance(response, AIMessage):
        # OpenAI reasoning models put chain‑of‑thought in additional_kwargs
        reasoning = (
            getattr(response, "reasoning_content", None)
            or (response.additional_kwargs or {}).get("reasoning_content")
            or (response.additional_kwargs or {}).get("reasoning")
        )
        if reasoning:
            # Split long reasoning into digestible thought steps
            for line in reasoning.strip().split("\n"):
                line = line.strip()
                if line:
                    thoughts.append(line)

    if isinstance(response, AIMessage) and getattr(response, "tool_calls", None):
        if len(response.tool_calls) > 1:
            thoughts.append(f"Planning {len(response.tool_calls)} tool calls to answer your question")
        for i, tc in enumerate(response.tool_calls, 1):
            readable = tc["name"].replace("_", " ").title()
            plan_steps.append({
                "id": i,
                "label": readable,
                "tool": tc["name"],
                "status": "pending",
            })
            # Add a contextual thought about what the tool does
            if "search" in tc["name"] or "list" in tc["name"] or "read" in tc["name"]:
                thoughts.append(f"Querying {readable.lower()}...")
            elif "create" in tc["name"] or "send" in tc["name"] or "write" in tc["name"]:
                thoughts.append(f"Preparing to {readable.lower()}")

    return {"messages": [response], "plan_steps": plan_steps, "thoughts": thoughts}


# ─── Node: Tool Execution ────────────────────────────────────────────────────


async def tool_execution_node(state: AgentState) -> dict:
    """Execute tools and generate receipt metadata + action cards."""
    # Build ToolNode with the same filtered tools used by llm_node
    tools = state.active_tools if state.active_tools else AGENT_TOOLS
    dynamic_tool_node = ToolNode(tools)

    try:
        result = await dynamic_tool_node.ainvoke(state)
    except Exception as e:
        # If ToolNode crashes (e.g. tool not found, network error),
        # generate a synthetic ToolMessage for every pending tool_call
        # so the graph can continue instead of dying.
        log.exception("ToolNode execution failed")
        last_msg = state.messages[-1] if state.messages else None
        synthetic_msgs = []
        if isinstance(last_msg, AIMessage) and getattr(last_msg, "tool_calls", None):
            for tc in last_msg.tool_calls:
                synthetic_msgs.append(ToolMessage(
                    content=f"Tool execution failed: {e}",
                    tool_call_id=tc.get("id", ""),
                    name=tc.get("name", "unknown"),
                ))
        result = {"messages": synthetic_msgs}

    # Build receipts and action cards from tool results
    receipts = []
    action_cards = []
    new_messages = result.get("messages", [])
    for msg in new_messages:
        tool_name = getattr(msg, "name", "unknown")
        raw_content = msg.content if hasattr(msg, "content") else str(msg)
        # Normalise content — Ollama / some models can return list content
        if isinstance(raw_content, list):
            content = "".join(
                item.get("text", str(item)) if isinstance(item, dict) else str(item)
                for item in raw_content
            )
        else:
            content = str(raw_content) if raw_content else ""
        receipt = {
            "tool": tool_name,
            "action": tool_name.replace("_", " ").title(),
            "summary": content[:200] if content else "Completed",
            "success": "error" not in content.lower() and "failed" not in content.lower(),
        }
        # Extract deep link if present
        link = None
        if "http" in content:
            import re
            urls = re.findall(r'https?://[^\s"\)]+', content)
            if urls:
                link = urls[0]
                receipt["link"] = link
        receipts.append(receipt)

        # Generate action cards for write operations that created something linkable
        if receipt["success"] and link:
            if any(kw in tool_name for kw in ("create", "send", "merge", "submit")):
                action_cards.append({
                    "type": "link",
                    "title": receipt["action"],
                    "description": receipt["summary"][:100],
                    "actions": [{"label": "Open", "url": link}],
                    "metadata": {"tool": tool_name},
                })

    result["receipts"] = receipts
    result["action_cards"] = action_cards
    result["tool_loop_count"] = state.tool_loop_count + 1
    return result


# ─── Node: Approval Check ────────────────────────────────────────────────────

async def approval_check_node(state: AgentState) -> dict:
    """Check if the last AI message contains tool calls requiring approval."""
    last_msg = state.messages[-1] if state.messages else None
    if not isinstance(last_msg, AIMessage) or not getattr(last_msg, "tool_calls", None):
        return {"pending_approval": None}

    for tc in last_msg.tool_calls:  # type: ignore[union-attr]
        if tc["name"] in APPROVAL_REQUIRED_TOOLS:
            return {
                "pending_approval": {
                    "tool_name": tc["name"],
                    "tool_args": tc["args"],
                    "tool_call_id": tc["id"],
                }
            }

    return {"pending_approval": None}


# ─── Routing Functions ────────────────────────────────────────────────────────

def should_continue(state: AgentState) -> str:
    """Route after LLM call: if tool calls → check approval; else → end."""
    last_msg = state.messages[-1] if state.messages else None
    if isinstance(last_msg, AIMessage) and getattr(last_msg, "tool_calls", None):
        return "approval_check"
    return END  # type: ignore[return-value]


def after_approval_check(state: AgentState) -> str:
    """Route after approval check: if approval needed → wait; else → execute tools."""
    if state.pending_approval:
        return "wait_approval"
    return "tools"


def after_tools(state: AgentState) -> str:
    """After tool execution, go back to LLM (with loop protection)."""
    if state.should_stop:
        return END  # type: ignore[return-value]
    if state.tool_loop_count >= MAX_TOOL_LOOPS:
        log.warning("Agent reached max tool loops (%d), stopping", MAX_TOOL_LOOPS)
        return END  # type: ignore[return-value]
    return "llm"


# ─── Build the graph ─────────────────────────────────────────────────────────

def build_agent_graph() -> StateGraph:
    """Build and compile the LangGraph agent."""
    graph = StateGraph(AgentState)

    # Add nodes
    graph.add_node("rag_retrieval", rag_retrieval_node)
    graph.add_node("llm", llm_node)
    graph.add_node("approval_check", approval_check_node)
    graph.add_node("tools", tool_execution_node)

    # Entry point: always start with RAG retrieval
    graph.set_entry_point("rag_retrieval")

    # RAG → LLM
    graph.add_edge("rag_retrieval", "llm")

    # LLM → check if tools needed
    graph.add_conditional_edges("llm", should_continue)

    # Approval check → tools or wait
    graph.add_conditional_edges(
        "approval_check",
        after_approval_check,
        {
            "tools": "tools",
            "wait_approval": END,  # Will resume when user approves
        },
    )

    # Tools → back to LLM
    graph.add_conditional_edges("tools", after_tools)

    return graph.compile()


# Singleton compiled graph
_agent_graph = None


def get_agent_graph():
    global _agent_graph
    if _agent_graph is None:
        _agent_graph = build_agent_graph()
    return _agent_graph
