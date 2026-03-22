"""Sub-agent spawning system for WorkOS.

Implements the LangChain supervisor pattern: sub-agents are wrapped as tools
that the main agent can call. Each sub-agent has a focused set of tools and
a service-specific system prompt.

The main agent decides automatically:
  - Simple tasks → uses MCP tools directly
  - Complex multi-step tasks → delegates to a sub-agent
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import BaseTool, StructuredTool
from langchain_ollama import ChatOllama

from workos.agent.services import ServiceConfig, get_all_services, match_service
from workos.agent.thinking import is_thinking_model
from workos.mcp.manager import mcp_manager

logger = logging.getLogger(__name__)


async def _run_sub_agent(
    request: str,
    *,
    service: ServiceConfig,
    tools: list[BaseTool],
    model_name: str,
    ollama_url: str,
) -> str:
    """Run a focused sub-agent for a specific service.

    The sub-agent gets only the tools for its service and a focused
    system prompt. It runs a simple ReAct loop (up to 10 iterations)
    and returns its final text response.
    """
    if not tools:
        return f"No {service.display_name} tools available. Is the service connected?"

    use_reasoning = is_thinking_model(model_name)
    llm = ChatOllama(
        model=model_name,
        base_url=ollama_url,
        reasoning=use_reasoning,
    ).bind_tools(tools)

    tool_map = {t.name: t for t in tools}
    system_prompt = (
        f"You are the {service.display_name} specialist agent for WorkOS. "
        f"You have access to {service.display_name} tools only. "
        f"Complete the user's request using these tools. "
        f"Be concise and report what you did.\n\n"
        f"{service.instructions}"
    )

    messages: list[Any] = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=request),
    ]

    max_iterations = 10
    for _ in range(max_iterations):
        response = await llm.ainvoke(messages)
        messages.append(response)

        if not response.tool_calls:
            # No more tool calls — return the text response
            content = response.content
            return content if isinstance(content, str) else str(content)

        # Execute tool calls
        from langchain_core.messages import ToolMessage

        for tc in response.tool_calls:
            name = tc["name"]
            args = tc["args"]
            tid = tc["id"]

            if name not in tool_map:
                messages.append(
                    ToolMessage(content=f"Error: Tool '{name}' not found.", tool_call_id=tid)
                )
                continue

            try:
                result = await tool_map[name].ainvoke(args)
                result_str = result if isinstance(result, str) else json.dumps(result, default=str)
                messages.append(ToolMessage(content=result_str, tool_call_id=tid))
            except Exception as e:
                logger.exception("Sub-agent tool %s failed", name)
                messages.append(ToolMessage(content=f"Error: {e}", tool_call_id=tid))

    return f"{service.display_name} agent completed (reached iteration limit)."


def _filter_tools_for_service(
    all_tools: list[BaseTool], service: ServiceConfig
) -> list[BaseTool]:
    """Filter tools to only those belonging to a specific service."""
    return [t for t in all_tools if t.name.startswith(service.tool_prefix)]


async def create_delegation_tools(
    model_name: str,
    ollama_url: str,
) -> list[BaseTool]:
    """Create delegation tools for all connected services.

    Returns a list of tools like `delegate_to_slack`, `delegate_to_github`, etc.
    Only creates delegation tools for services that have connected MCP servers.
    """
    from workos.db.database import get_db

    # Get enabled MCP server names
    db = await get_db()
    cursor = await db.execute("SELECT name FROM mcp_servers WHERE enabled = 1")
    rows = await cursor.fetchall()
    server_names = [row[0] for row in rows]

    if not server_names:
        return []

    # Get all MCP tools
    all_tools = await mcp_manager.get_tools()

    # Create delegation tools for connected services
    delegation_tools: list[BaseTool] = []

    for server_name in server_names:
        service = match_service(server_name)
        if not service:
            continue

        service_tools = _filter_tools_for_service(all_tools, service)
        if not service_tools:
            continue

        # Capture variables in closure
        _service = service
        _tools = service_tools

        async def _delegate(request: str, *, _s=_service, _t=_tools) -> str:
            return await _run_sub_agent(
                request,
                service=_s,
                tools=_t,
                model_name=model_name,
                ollama_url=ollama_url,
            )

        tool = StructuredTool.from_function(
            coroutine=_delegate,
            name=f"delegate_to_{service.name}",
            description=service.delegation_description,
        )
        delegation_tools.append(tool)

        logger.info(
            "Created delegation tool: delegate_to_%s (%d service tools)",
            service.name,
            len(service_tools),
        )

    return delegation_tools
