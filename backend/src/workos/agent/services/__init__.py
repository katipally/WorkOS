"""Service registry for WorkOS integrations.

Each service module defines:
  - SERVICE_NAME: Display name
  - SERVICE_INSTRUCTIONS: System prompt section with tool usage tips
  - SERVICE_TOOL_PREFIX: Tool name prefix to match (e.g., "slack_")
  - DELEGATION_DESCRIPTION: Description for the delegation tool
"""

from __future__ import annotations

import importlib
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class ServiceConfig:
    """Configuration for a registered service."""

    name: str
    display_name: str
    tool_prefix: str
    instructions: str
    delegation_description: str


# Known service modules — import lazily to avoid circular deps
_SERVICE_MODULES = {
    "slack": "workos.agent.services.slack",
    "github": "workos.agent.services.github",
    "jira": "workos.agent.services.jira",
}

_cache: dict[str, ServiceConfig] = {}


def get_service(name: str) -> ServiceConfig | None:
    """Get a service config by name (e.g., 'slack', 'github')."""
    if name in _cache:
        return _cache[name]

    module_path = _SERVICE_MODULES.get(name)
    if not module_path:
        return None

    try:
        mod = importlib.import_module(module_path)
        config = ServiceConfig(
            name=name,
            display_name=mod.SERVICE_NAME,
            tool_prefix=mod.SERVICE_TOOL_PREFIX,
            instructions=mod.SERVICE_INSTRUCTIONS,
            delegation_description=mod.DELEGATION_DESCRIPTION,
        )
        _cache[name] = config
        return config
    except Exception:
        logger.exception("Failed to load service module: %s", module_path)
        return None


def get_all_services() -> dict[str, ServiceConfig]:
    """Get all registered service configs."""
    for name in _SERVICE_MODULES:
        get_service(name)
    return dict(_cache)


def match_service(server_name: str) -> ServiceConfig | None:
    """Match an MCP server name to a known service.

    Tries exact match first, then substring matching.
    E.g., "slack" or "my-slack-server" → Slack service.
    """
    lower = server_name.lower()

    # Exact match
    svc = get_service(lower)
    if svc:
        return svc

    # Substring match
    for name in _SERVICE_MODULES:
        if name in lower:
            return get_service(name)

    return None
