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
from services.agent.tools import AGENT_TOOLS
from services.agent.prompts import build_system_prompt
from services.ai_service import get_llm
from services.rag_service import search_documents

log = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
LLM_TIMEOUT_SECONDS = 90
MAX_TOOL_LOOPS = 10

# Tools that require approval before executing
APPROVAL_REQUIRED_TOOLS = {
    # Slack write operations
    "slack_send_message",
    "slack_send_dm",
    "slack_pin_message",
    "slack_schedule_message",
    "slack_edit_message",
    "slack_delete_message",
    # GitHub write operations
    "github_create_issue",
    "github_create_branch",
    "github_submit_pr_review",
    "github_merge_pr",
    "github_create_release",
}


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
            per_source_k = max(2, 6 // len(state.context_mentions))
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
            return {"rag_context": deduped[:6]}

        elif state.scope == "tab":
            source_filter = tab_to_source.get(state.focused_tab)
            results = await search_documents(last_user_msg, top_k=5, source_filter=source_filter)
            return {"rag_context": results}

        else:
            results = await search_documents(last_user_msg, top_k=6)
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
    )

    # Add RAG context to system prompt if available
    if state.rag_context:
        rag_text = "\n\n## Relevant Context (from indexed documents/data)\n"
        for i, ctx in enumerate(state.rag_context[:5], 1):
            source = ctx.get("source", "unknown")
            title = ctx.get("title", ctx.get("filename", ""))
            content = ctx.get("content", "")[:500]
            rag_text += f"\n### [{i}] {source}: {title}\n{content}\n"
        system_prompt += rag_text

    # Smart compaction: summarize old messages if conversation is long
    conv_messages = state.messages
    compaction_performed = False
    if len(conv_messages) > 20:
        try:
            summary_llm = await get_llm("ai", streaming=False, temperature=0.3)
            old_msgs = conv_messages[:-10]  # Keep last 10 intact
            recent_msgs = conv_messages[-10:]
            old_text = "\n".join(
                f"{getattr(m, 'type', 'unknown')}: {m.content[:200]}"
                for m in old_msgs if hasattr(m, 'content') and m.content
            )
            summary_resp = await summary_llm.ainvoke([
                SystemMessage(content="Summarize the following conversation history concisely. Preserve key decisions, action items, and context."),
                HumanMessage(content=old_text[:4000]),
            ])
            system_prompt += f"\n\n## Summary of Earlier Conversation\n{summary_resp.content}\n"
            conv_messages = recent_msgs
            compaction_performed = True
        except Exception as e:
            log.warning("Smart compaction failed: %s", e)

    # Prepare messages with system prompt
    messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
    messages.extend(conv_messages)

    # Get LLM with tools (streaming=True enables real token-by-token streaming
    # when the graph is invoked with stream_mode including "messages")
    llm = await get_llm("ai", streaming=True, temperature=0.7)
    llm_with_tools = llm.bind_tools(AGENT_TOOLS)

    try:
        response = await asyncio.wait_for(
            llm_with_tools.ainvoke(messages),
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning("LLM call timed out after %ds", LLM_TIMEOUT_SECONDS)
        response = AIMessage(content="I'm sorry, the request took too long. Please try again with a simpler question.")

    # Generate plan steps for multi-tool calls
    plan_steps = []
    thoughts = []

    if compaction_performed:
        thoughts.append("Summarized earlier conversation to stay within context limits")

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

tool_node = ToolNode(AGENT_TOOLS)


async def tool_execution_node(state: AgentState) -> dict:
    """Execute tools and generate receipt metadata + action cards."""
    result = await tool_node.ainvoke(state)

    # Build receipts and action cards from tool results
    receipts = []
    action_cards = []
    new_messages = result.get("messages", [])
    for msg in new_messages:
        tool_name = getattr(msg, "name", "unknown")
        content = msg.content if hasattr(msg, "content") else str(msg)
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
