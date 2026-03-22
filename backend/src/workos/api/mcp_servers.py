from __future__ import annotations

from fastapi import APIRouter, HTTPException

from workos.db.models import MCPServerCreate, MCPServerOut, MCPServerUpdate, ToolApprovalUpdate
from workos.mcp.registry import (
    create_server,
    delete_server,
    get_server,
    list_servers,
    set_tool_approval,
    update_server,
)
from workos.mcp.manager import mcp_manager
from workos.agent.prompt_composer import invalidate_cache as invalidate_prompt_cache

router = APIRouter(tags=["mcp_servers"])


@router.get("/mcp-servers", response_model=list[MCPServerOut])
async def list_mcp_servers():
    return await list_servers()


@router.post("/mcp-servers")
async def add_mcp_server(data: MCPServerCreate):
    server = await create_server(data)
    err = await mcp_manager.refresh()
    invalidate_prompt_cache()
    result = server.model_dump()
    if err:
        result["connection_error"] = err
    return result


@router.get("/mcp-tools")
async def list_all_tools():
    """List all tools from all connected MCP servers."""
    tools = await mcp_manager.get_tools()
    return {
        "tools": [
            {
                "name": t.name,
                "description": t.description or "",
            }
            for t in tools
        ]
    }


@router.get("/mcp-servers/{server_id}", response_model=MCPServerOut)
async def get_mcp_server(server_id: str):
    server = await get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    return server


@router.put("/mcp-servers/{server_id}", response_model=MCPServerOut)
async def update_mcp_server(server_id: str, data: MCPServerUpdate):
    server = await update_server(server_id, data)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")
    await mcp_manager.refresh()
    invalidate_prompt_cache()
    return server


@router.delete("/mcp-servers/{server_id}")
async def remove_mcp_server(server_id: str):
    await delete_server(server_id)
    await mcp_manager.refresh()
    invalidate_prompt_cache()
    return {"status": "deleted", "id": server_id}


@router.post("/mcp-servers/{server_id}/test")
async def test_mcp_server(server_id: str):
    """Test connectivity to a specific MCP server.

    Attempts to connect and discover tools from the server.
    Returns tool count on success, or error details on failure.
    """
    server = await get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    result = await mcp_manager.test_server(server.name)
    return result


@router.get("/mcp-servers/{server_id}/tools")
async def list_server_tools(server_id: str):
    """List tools available from a specific MCP server."""
    server = await get_server(server_id)
    if not server:
        raise HTTPException(status_code=404, detail="MCP server not found")

    tools = mcp_manager.get_server_tools(server.name)
    return {
        "server_name": server.name,
        "tools": [
            {"name": t.name, "description": t.description or ""}
            for t in tools
        ],
    }


@router.put("/mcp-servers/{server_id}/tools/{tool_name}/approval")
async def update_tool_approval(
    server_id: str, tool_name: str, data: ToolApprovalUpdate
):
    await set_tool_approval(server_id, tool_name, data.requires_approval)
    return {
        "status": "updated",
        "server_id": server_id,
        "tool_name": tool_name,
        "requires_approval": data.requires_approval,
    }
