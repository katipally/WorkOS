"""Service status API endpoints."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter

from workos.agent.prompt_composer import (
    compose_system_prompt,
    get_connected_service_names,
    invalidate_cache,
)
from workos.agent.services import get_all_services, match_service
from workos.db.database import get_db
from workos.mcp.manager import mcp_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["services"])


@router.get("/services/status")
async def get_service_status():
    """Get connection status for all known services."""
    all_services = get_all_services()
    db = await get_db()

    # Get enabled MCP servers
    cursor = await db.execute(
        "SELECT id, name, enabled FROM mcp_servers WHERE enabled = 1"
    )
    rows = await cursor.fetchall()

    # Map servers to services
    connected_map: dict[str, dict] = {}
    for row in rows:
        server_id, server_name, enabled = row
        svc = match_service(server_name)
        if svc:
            connected_map[svc.name] = {
                "server_id": server_id,
                "server_name": server_name,
            }

    # Get tool counts from MCP manager
    tools = await mcp_manager.get_tools()
    tool_counts: dict[str, int] = {}
    for svc in all_services.values():
        count = sum(1 for t in tools if t.name.startswith(svc.tool_prefix))
        tool_counts[svc.name] = count

    # Build response
    result = []
    for name, svc in all_services.items():
        info = connected_map.get(name)
        result.append({
            "name": name,
            "display_name": svc.display_name,
            "connected": name in connected_map,
            "tools_count": tool_counts.get(name, 0),
            "server_id": info["server_id"] if info else None,
        })

    # Add placeholder entries for services not yet registered
    known_future = {
        "gmail": "Gmail",
        "gmeet": "Google Meet",
    }
    for name, display in known_future.items():
        if name not in all_services:
            result.append({
                "name": name,
                "display_name": display,
                "connected": False,
                "tools_count": 0,
                "server_id": None,
                "coming_soon": True,
            })

    return result


@router.post("/services/prompt/regenerate")
async def regenerate_prompt():
    """Force-recompose the system prompt from current services."""
    invalidate_cache()
    prompt = await compose_system_prompt()
    connected = await get_connected_service_names()
    return {
        "status": "ok",
        "connected_services": connected,
        "prompt_length": len(prompt),
    }
