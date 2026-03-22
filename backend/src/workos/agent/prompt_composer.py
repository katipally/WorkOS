"""Dynamic system prompt composer for WorkOS.

Composes the agent system prompt from a base template plus
service-specific sections based on which MCP servers are connected.

The composed prompt is cached and invalidated whenever MCP servers
are added, removed, or toggled.
"""

from __future__ import annotations

import logging

from workos.agent.services import get_all_services, match_service
from workos.agent.services.base import BASE_SYSTEM_PROMPT, NO_SERVICES_SECTION
from workos.db.database import get_db

logger = logging.getLogger(__name__)

_cached_prompt: str | None = None


def invalidate_cache() -> None:
    """Clear the cached prompt so it recomposes on next call."""
    global _cached_prompt
    _cached_prompt = None
    logger.info("System prompt cache invalidated")


async def compose_system_prompt(user_prompt_override: str | None = None) -> str:
    """Compose the full system prompt from connected services.

    Args:
        user_prompt_override: If set, prepend this custom prompt to the
            auto-composed prompt. This is the user-configured system prompt
            from settings (if any).

    Returns:
        The complete system prompt string.
    """
    global _cached_prompt

    if _cached_prompt is not None and user_prompt_override is None:
        return _cached_prompt

    # Load enabled MCP server names from DB
    db = await get_db()
    cursor = await db.execute(
        "SELECT name FROM mcp_servers WHERE enabled = 1"
    )
    rows = await cursor.fetchall()
    server_names = [row[0] for row in rows]

    # Match servers to known services
    all_services = get_all_services()
    connected_services = []
    for name in server_names:
        svc = match_service(name)
        if svc:
            connected_services.append(svc)

    # Build service sections
    if connected_services:
        # Deduplicate by service name
        seen = set()
        sections = []
        for svc in connected_services:
            if svc.name not in seen:
                seen.add(svc.name)
                sections.append(svc.instructions)
        service_text = "\n\n".join(sections)
    else:
        service_text = NO_SERVICES_SECTION

    # Compose the full prompt
    composed = BASE_SYSTEM_PROMPT.format(service_sections=service_text)

    # Prepend user override if provided
    if user_prompt_override and user_prompt_override.strip():
        composed = user_prompt_override.strip() + "\n\n" + composed

    # Cache (only when no user override — the override changes per-request)
    if user_prompt_override is None:
        _cached_prompt = composed

    logger.info(
        "Composed system prompt: %d services connected, %d chars",
        len(connected_services) if connected_services else 0,
        len(composed),
    )
    return composed


async def get_connected_service_names() -> list[str]:
    """Get names of services that are currently connected."""
    db = await get_db()
    cursor = await db.execute(
        "SELECT name FROM mcp_servers WHERE enabled = 1"
    )
    rows = await cursor.fetchall()

    connected = []
    for row in rows:
        svc = match_service(row[0])
        if svc:
            connected.append(svc.name)
    return list(set(connected))
