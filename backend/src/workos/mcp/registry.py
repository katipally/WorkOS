from __future__ import annotations

import json
import uuid

from workos.db.database import get_db
from workos.db.models import MCPServerCreate, MCPServerOut, MCPServerUpdate


async def list_servers() -> list[MCPServerOut]:
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, name, transport, config, enabled, created_at FROM mcp_servers ORDER BY name"
    )
    rows = await cursor.fetchall()

    servers = []
    for row in rows:
        server_id = row[0]
        # Get tool approvals
        ta_cursor = await db.execute(
            "SELECT tool_name, requires_approval FROM tool_approvals WHERE server_id = ?",
            (server_id,),
        )
        ta_rows = await ta_cursor.fetchall()
        approvals = {r[0]: bool(r[1]) for r in ta_rows}

        servers.append(
            MCPServerOut(
                id=row[0],
                name=row[1],
                transport=row[2],
                config=json.loads(row[3]),
                enabled=bool(row[4]),
                created_at=row[5],
                tool_approvals=approvals,
            )
        )
    return servers


async def create_server(data: MCPServerCreate) -> MCPServerOut:
    db = await get_db()
    server_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO mcp_servers (id, name, transport, config, enabled) VALUES (?, ?, ?, ?, ?)",
        (server_id, data.name, data.transport, json.dumps(data.config), int(data.enabled)),
    )
    await db.commit()

    cursor = await db.execute(
        "SELECT id, name, transport, config, enabled, created_at FROM mcp_servers WHERE id = ?",
        (server_id,),
    )
    row = await cursor.fetchone()
    return MCPServerOut(
        id=row[0],
        name=row[1],
        transport=row[2],
        config=json.loads(row[3]),
        enabled=bool(row[4]),
        created_at=row[5],
    )


async def update_server(server_id: str, data: MCPServerUpdate) -> MCPServerOut | None:
    db = await get_db()
    updates = []
    params = []

    if data.name is not None:
        updates.append("name = ?")
        params.append(data.name)
    if data.transport is not None:
        updates.append("transport = ?")
        params.append(data.transport)
    if data.config is not None:
        updates.append("config = ?")
        params.append(json.dumps(data.config))
    if data.enabled is not None:
        updates.append("enabled = ?")
        params.append(int(data.enabled))

    if not updates:
        return await get_server(server_id)

    params.append(server_id)
    await db.execute(
        f"UPDATE mcp_servers SET {', '.join(updates)} WHERE id = ?",
        params,
    )
    await db.commit()
    return await get_server(server_id)


async def get_server(server_id: str) -> MCPServerOut | None:
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, name, transport, config, enabled, created_at FROM mcp_servers WHERE id = ?",
        (server_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None

    ta_cursor = await db.execute(
        "SELECT tool_name, requires_approval FROM tool_approvals WHERE server_id = ?",
        (server_id,),
    )
    ta_rows = await ta_cursor.fetchall()
    approvals = {r[0]: bool(r[1]) for r in ta_rows}

    return MCPServerOut(
        id=row[0],
        name=row[1],
        transport=row[2],
        config=json.loads(row[3]),
        enabled=bool(row[4]),
        created_at=row[5],
        tool_approvals=approvals,
    )


async def delete_server(server_id: str) -> bool:
    db = await get_db()
    cursor = await db.execute("DELETE FROM mcp_servers WHERE id = ?", (server_id,))
    await db.commit()
    return cursor.rowcount > 0


async def set_tool_approval(server_id: str, tool_name: str, requires_approval: bool):
    db = await get_db()
    await db.execute(
        """
        INSERT INTO tool_approvals (server_id, tool_name, requires_approval)
        VALUES (?, ?, ?)
        ON CONFLICT(server_id, tool_name) DO UPDATE SET requires_approval = ?
        """,
        (server_id, tool_name, int(requires_approval), int(requires_approval)),
    )
    await db.commit()
