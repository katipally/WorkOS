"""
AI Session CRUD Router — list, create, get, update, delete chat sessions.
"""

from __future__ import annotations

import json
import logging
import uuid

from fastapi import APIRouter, HTTPException

from db.connection import get_pool
from schemas.ai import SessionCreate, SessionUpdate
from services.chat_helpers import safe_jsonb

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


def _session_to_dict(r) -> dict:
    """Convert a session DB row to a JSON-serializable dict."""
    return {
        "id": str(r["id"]),
        "title": r["title"],
        "focused_tab": r["focused_tab"],
        "scope": r["scope"],
        "branch_id": r["branch_id"],
        "max_branch": r["max_branch"],
        "created_at": r["created_at"].isoformat(),
        "updated_at": r["updated_at"].isoformat(),
    }


@router.get("/sessions")
async def list_sessions():
    """List all chat sessions, most recent first."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, title, focused_tab, scope, branch_id, max_branch,
                  created_at, updated_at
           FROM chat_sessions ORDER BY updated_at DESC"""
    )
    return [_session_to_dict(r) for r in rows]


@router.post("/sessions")
async def create_session(req: SessionCreate):
    """Create a new chat session."""
    pool = get_pool()
    row = await pool.fetchrow(
        """INSERT INTO chat_sessions (title, focused_tab, scope)
           VALUES ($1, $2, $3) RETURNING *""",
        req.title, req.focused_tab, req.scope,
    )
    return _session_to_dict(row)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a session with all its messages."""
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")

    messages = await pool.fetch(
        """SELECT id, branch_id, role, content, tool_calls, tool_name,
                  tool_result, metadata, pinned, created_at
           FROM chat_messages
           WHERE session_id = $1 AND branch_id = $2
           ORDER BY created_at""",
        uuid.UUID(session_id), session["branch_id"],
    )

    return {
        **_session_to_dict(session),
        "messages": [
            {
                "id": str(m["id"]),
                "branch_id": m["branch_id"],
                "role": m["role"],
                "content": m["content"],
                "tool_calls": safe_jsonb(m["tool_calls"], []),
                "tool_name": m["tool_name"],
                "tool_result": safe_jsonb(m["tool_result"], None),
                "metadata": safe_jsonb(m["metadata"], {}),
                "pinned": m["pinned"],
                "created_at": m["created_at"].isoformat(),
            }
            for m in messages
        ],
    }


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, req: SessionUpdate):
    """Update session title or scope."""
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")

    title = req.title if req.title is not None else session["title"]
    scope = req.scope if req.scope is not None else session["scope"]
    branch_id = req.branch_id if req.branch_id is not None else session["branch_id"]

    # Clamp branch_id within valid range
    if branch_id < 1:
        branch_id = 1
    if branch_id > session["max_branch"]:
        branch_id = session["max_branch"]

    await pool.execute(
        """UPDATE chat_sessions SET title = $2, scope = $3, branch_id = $4, updated_at = NOW()
           WHERE id = $1""",
        uuid.UUID(session_id), title, scope, branch_id,
    )
    return {"ok": True, "branch_id": branch_id}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a chat session and all its messages."""
    pool = get_pool()
    await pool.execute(
        "DELETE FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    return {"ok": True}
