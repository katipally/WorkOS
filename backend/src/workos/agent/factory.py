"""Custom LangGraph ReAct Agent for WorkOS.

Built directly with LangGraph for full Ollama compatibility. Follows the same
patterns as DeepAgents (planning/todos, HITL, checkpointing) but without the
Anthropic-specific middleware that would break Ollama-only setups.

The agent is built once per tool configuration and cached. Dynamic values
(model name, Ollama URL, system prompt) are read from configurable at runtime
so the same compiled graph works across different model selections.

Architecture:
  agent → (has tool_calls?) → tools → agent → ... → (no tool_calls) → END
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool, tool
from langchain_ollama import ChatOllama
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from workos.agent.thinking import is_thinking_model

from workos.agent.checkpointer import get_checkpointer
from workos.agent.prompt_composer import compose_system_prompt
from workos.agent.subagents import create_delegation_tools
from workos.config import settings
from workos.db.database import get_db
from workos.mcp.manager import mcp_manager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Agent State
# ---------------------------------------------------------------------------

class WorkOSState(TypedDict):
    """Extended agent state with messages and planning todos."""

    messages: Annotated[list[BaseMessage], add_messages]
    todos: list[dict]


# ---------------------------------------------------------------------------
# Built-in Tools
# ---------------------------------------------------------------------------

@tool
def write_todos(todos: list[dict]) -> str:
    """Create or update a planning todo list. Use this to plan and track complex tasks.

    Call this whenever you need to:
    - Break down a complex task into steps before starting
    - Track progress on a multi-step task
    - Mark tasks as done when completed

    Args:
        todos: List of todo items. Each should have:
            - title: Short description of the task
            - status: One of 'pending', 'in_progress', or 'done'

    Example:
        write_todos([
            {"title": "Research the topic", "status": "done"},
            {"title": "Draft the outline", "status": "in_progress"},
            {"title": "Write the content", "status": "pending"},
        ])
    """
    formatted = []
    for t in todos:
        status = t.get("status", "pending")
        icon = {"pending": "⬜", "in_progress": "🔄", "done": "✅"}.get(status, "⬜")
        formatted.append(f"{icon} {t.get('title', 'Untitled')}")
    return "Todo list updated:\n" + "\n".join(formatted)


BUILTIN_TOOLS: list[BaseTool] = [write_todos]


# ---------------------------------------------------------------------------
# Graph Builder
# ---------------------------------------------------------------------------

def _build_graph(
    *,
    all_tools: list[BaseTool],
    checkpointer,
    interrupt_tool_names: set[str],
) -> CompiledStateGraph:
    """Build and compile the ReAct agent graph.

    Nodes:
      agent  — calls the LLM with all tools bound
      tools  — executes tool calls (parallel), handles HITL interrupt, updates todos

    Dynamic configuration (model name, URL, system prompt) is read from
    ``config["configurable"]`` at runtime so the same compiled graph works
    across different model selections.
    """
    tool_map = {t.name: t for t in all_tools}

    async def agent_node(state: WorkOSState, config: RunnableConfig) -> dict:
        """Call the LLM with tools bound."""
        logger.debug("agent_node: messages=%d", len(state.get("messages", [])))
        cfg = config.get("configurable", {})
        model_name = cfg.get("model") or settings.ollama_model
        ollama_url = cfg.get("ollama_url") or settings.ollama_url

        # Use dynamic composed prompt (includes connected service instructions)
        user_override = cfg.get("system_prompt")
        system_prompt = await compose_system_prompt(user_override)

        # Enable native reasoning for thinking-capable models only;
        # explicitly disable for others so Ollama doesn't default to thinking
        use_reasoning = is_thinking_model(model_name)
        model = ChatOllama(
            model=model_name,
            base_url=ollama_url,
            reasoning=use_reasoning,
        )
        if all_tools:
            model = model.bind_tools(all_tools)

        messages = list(state["messages"])
        if system_prompt and not any(isinstance(m, SystemMessage) for m in messages):
            messages = [SystemMessage(content=system_prompt)] + messages

        response = await model.ainvoke(messages)
        return {"messages": [response]}

    async def tools_node(state: WorkOSState, config: RunnableConfig) -> dict:
        """Execute tool calls with optional HITL interrupt and todo state updates."""
        last = state["messages"][-1]
        if not isinstance(last, AIMessage) or not last.tool_calls:
            return {"messages": []}

        results: list[ToolMessage] = []
        todo_update = None

        for tc in last.tool_calls:
            name = tc["name"]
            args = tc["args"]
            tid = tc["id"]

            # HITL: interrupt if tool requires approval
            if name in interrupt_tool_names:
                decision = interrupt({
                    "tool_call_id": tid,
                    "tool_name": name,
                    "args": args,
                    "message": f"Tool '{name}' requires approval.",
                })
                if isinstance(decision, dict) and decision.get("decision") == "reject":
                    results.append(ToolMessage(content="Tool call rejected by user.", tool_call_id=tid))
                    continue

            if name not in tool_map:
                results.append(ToolMessage(content=f"Error: Tool '{name}' not found.", tool_call_id=tid))
                continue

            try:
                result = await tool_map[name].ainvoke(args)
                result_str = result if isinstance(result, str) else json.dumps(result, default=str)
                results.append(ToolMessage(content=result_str, tool_call_id=tid))

                if name == "write_todos":
                    todo_update = args.get("todos", [])
            except Exception as e:
                logger.exception("Tool %s failed", name)
                results.append(ToolMessage(content=f"Error: {e}", tool_call_id=tid))

        updates: dict = {"messages": results}
        if todo_update is not None:
            updates["todos"] = todo_update
        return updates

    def should_continue(state: WorkOSState) -> str:
        last = state["messages"][-1] if state["messages"] else None
        if last is None:
            return "end"
        if isinstance(last, AIMessage) and last.tool_calls:
            return "tools"
        return "end"

    builder = StateGraph(WorkOSState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", tools_node)
    builder.set_entry_point("agent")
    builder.add_conditional_edges("agent", should_continue, {"tools": "tools", "end": END})
    builder.add_edge("tools", "agent")

    return builder.compile(checkpointer=checkpointer)


# ---------------------------------------------------------------------------
# HITL tool name loader
# ---------------------------------------------------------------------------


async def _load_interrupt_names() -> set[str]:
    """Load tool names that require HITL approval from the database."""
    db = await get_db()
    cursor = await db.execute(
        """
        SELECT ta.tool_name
        FROM tool_approvals ta
        JOIN mcp_servers ms ON ta.server_id = ms.id
        WHERE ms.enabled = 1 AND ta.requires_approval = 1
        """,
    )
    rows = await cursor.fetchall()
    return {row[0] for row in rows}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def get_agent() -> CompiledStateGraph:
    """Build a fresh agent graph for each invocation.

    We intentionally do NOT cache the compiled graph because LangGraph's
    Pregel runner keeps internal async state that can deadlock when a
    compiled graph is reused across concurrent or sequential astream() calls.
    Building the graph is cheap (microseconds); the LLM call dominates.
    """
    external_tools = await mcp_manager.get_tools()
    all_tools = BUILTIN_TOOLS + list(external_tools)

    # Add delegation tools for connected services (sub-agent pattern)
    try:
        delegation_tools = await create_delegation_tools(
            model_name=settings.ollama_model,
            ollama_url=settings.ollama_url,
        )
        all_tools = all_tools + delegation_tools
    except Exception:
        logger.warning("Failed to create delegation tools", exc_info=True)

    interrupt_names = await _load_interrupt_names()
    checkpointer = get_checkpointer()

    graph = _build_graph(
        all_tools=all_tools,
        checkpointer=checkpointer,
        interrupt_tool_names=interrupt_names,
    )
    logger.info("Built agent graph: tools=%d, interrupts=%d", len(all_tools), len(interrupt_names))
    return graph
