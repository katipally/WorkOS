"""
Agent tool definitions for LangGraph — re-exports from per-integration modules.

This module assembles the AGENT_TOOLS list and provides scope-aware filtering
via get_tools_for_context(). The actual tool implementations live in:
  - slack_tools.py   — Slack read/write operations
  - github_tools.py  — GitHub read/write operations
  - meetings_tools.py — Meetings + RAG search
"""

from __future__ import annotations

import logging
from typing import Optional

from db.connection import get_pool

# Import all tool lists from per-integration modules
from services.agent.slack_tools import SLACK_TOOLS
from services.agent.github_tools import GITHUB_TOOLS
from services.agent.meetings_tools import MEETINGS_TOOLS, RAG_TOOLS

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# All agent tools list — exported for graph.py
# ═══════════════════════════════════════════════════════════════════════════════

AGENT_TOOLS = [
    *SLACK_TOOLS,
    *GITHUB_TOOLS,
    *MEETINGS_TOOLS,
    *RAG_TOOLS,
]


# ═══════════════════════════════════════════════════════════════════════════════
# Scope-aware tool filtering — reduces tool count for reliable tool calling
# ═══════════════════════════════════════════════════════════════════════════════

# Tools always available regardless of scope
_COMMON_TOOLS = list(RAG_TOOLS)

# Tools grouped by integration
_SETTINGS_TOOLS: list = []  # Populated lazily
_OAUTH_TOOLS: list = []  # Populated lazily

_TAB_TO_TOOLS: dict[str, list] = {
    "slack": SLACK_TOOLS,
    "github": GITHUB_TOOLS,
    "meetings": MEETINGS_TOOLS,
    "settings": _SETTINGS_TOOLS,
}

# Map integration names → OAuth provider used by that integration
_INTEGRATION_PROVIDER: dict[str, str | None] = {
    "slack": "slack",
    "github": "github",
    "meetings": None,  # meetings are local (no OAuth needed)
}


async def _get_connected_providers() -> set[str]:
    """Return names of OAuth providers that currently have a valid token."""
    try:
        from services.oauth_service import get_connection_status
        statuses = await get_connection_status()
        return {p for p, info in statuses.items() if info.get("connected")}
    except Exception:
        return set()  # on failure, assume nothing is connected


def get_tools_for_context(
    scope: str = "workspace",
    focused_tab: str = "slack",
    context_mentions: list[str] | None = None,
    connected_providers: set[str] | None = None,
) -> list:
    """Return a filtered tool set based on scope, tab, @mentions, and OAuth connectivity.

    - @mentions → union of mentioned integrations + common
    - scope == "tab" → tools for the active tab + common
    - scope == "workspace" → all tools

    When *connected_providers* is given, integrations whose OAuth provider
    is NOT connected are excluded (except meetings, which is local).
    """
    def _filter_connected(tools: list, integration: str) -> list:
        if connected_providers is None:
            return tools
        provider = _INTEGRATION_PROVIDER.get(integration)
        if provider is None:
            return tools  # local integration (meetings) — always available
        if provider in connected_providers:
            return tools
        return []  # provider not connected — omit tools

    # @mentions take priority over tab scope
    if context_mentions:
        tools = list(_COMMON_TOOLS)
        seen = {id(t) for t in tools}
        for mention in context_mentions:
            tab_tools = _TAB_TO_TOOLS.get(mention, [])
            filtered = _filter_connected(tab_tools, mention)
            for t in filtered:
                if id(t) not in seen:
                    tools.append(t)
                    seen.add(id(t))
        return tools

    if scope == "tab":
        tab_tools = _TAB_TO_TOOLS.get(focused_tab, [])
        filtered = _filter_connected(tab_tools, focused_tab)
        return list(_COMMON_TOOLS) + filtered

    # workspace scope: return all tools minus disconnected integrations
    if connected_providers is not None:
        tools = list(_COMMON_TOOLS)
        seen = {id(t) for t in tools}
        for integration, tab_tools in _TAB_TO_TOOLS.items():
            filtered = _filter_connected(tab_tools, integration)
            for t in filtered:
                if id(t) not in seen:
                    tools.append(t)
                    seen.add(id(t))
        return tools

    return list(AGENT_TOOLS)
