"""
Meeting read tools — list, get, summary, action items.
"""

from __future__ import annotations

import json
import uuid

from tools import tool
from tools.base import EmptyInput
from tools.meetings.models import MeetingIdInput, MeetingOut, MeetingsListOut
from db.connection import get_pool


@tool(
    name="meetings_list_meetings",
    description="List all meetings, most recent first",
    integration="meetings",
    method="GET",
    path="/",
    cache_ttl=30,
)
async def meetings_list_meetings(inp: EmptyInput) -> MeetingsListOut:
    """List all meetings, most recent first."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT m.*, COALESCE(
               json_agg(
                   json_build_object(
                       'id', mf.id::text,
                       'filename', mf.filename,
                       'filetype', mf.filetype,
                       'filesize', mf.filesize,
                       'mime_type', mf.mime_type,
                       'status', mf.status
                   )
               ) FILTER (WHERE mf.id IS NOT NULL), '[]'::json
           ) AS files
           FROM meetings m
           LEFT JOIN meeting_files mf ON mf.meeting_id = m.id
           GROUP BY m.id
           ORDER BY m.meeting_date DESC"""
    )
    meetings = []
    for r in rows:
        meetings.append(MeetingOut(
            id=str(r["id"]),
            title=r["title"],
            description=r["description"],
            meeting_date=r["meeting_date"].isoformat() if r["meeting_date"] else "",
            status=r["status"],
            summary=r["summary"],
            action_items=json.loads(r["action_items"]) if r["action_items"] else [],
            error=r["error"],
            created_at=r["created_at"].isoformat() if r["created_at"] else "",
            updated_at=r["updated_at"].isoformat() if r["updated_at"] else "",
            files=json.loads(r["files"]) if isinstance(r["files"], str) else r["files"],
        ))
    return MeetingsListOut(meetings=meetings)


@tool(
    name="meetings_get_meeting",
    description="Get a single meeting with its files",
    integration="meetings",
    method="GET",
    path="/{meeting_id}",
)
async def meetings_get_meeting(inp: MeetingIdInput) -> MeetingOut:
    """Get a single meeting with its files."""
    meeting_id = inp.meeting_id
    pool = get_pool()
    r = await pool.fetchrow(
        """SELECT m.*, COALESCE(
               json_agg(
                   json_build_object(
                       'id', mf.id::text,
                       'filename', mf.filename,
                       'filetype', mf.filetype,
                       'filesize', mf.filesize,
                       'mime_type', mf.mime_type,
                       'status', mf.status,
                       'transcription', mf.transcription
                   )
               ) FILTER (WHERE mf.id IS NOT NULL), '[]'::json
           ) AS files
           FROM meetings m
           LEFT JOIN meeting_files mf ON mf.meeting_id = m.id
           WHERE m.id = $1
           GROUP BY m.id""",
        uuid.UUID(meeting_id),
    )
    if not r:
        return MeetingOut(
            id=meeting_id, title="Not Found", description="", meeting_date="",
            status="error", error="Meeting not found", created_at="", updated_at="",
        )
    return MeetingOut(
        id=str(r["id"]),
        title=r["title"],
        description=r["description"],
        meeting_date=r["meeting_date"].isoformat() if r["meeting_date"] else "",
        status=r["status"],
        summary=r["summary"],
        action_items=json.loads(r["action_items"]) if r["action_items"] else [],
        error=r["error"],
        created_at=r["created_at"].isoformat() if r["created_at"] else "",
        updated_at=r["updated_at"].isoformat() if r["updated_at"] else "",
        files=json.loads(r["files"]) if isinstance(r["files"], str) else r["files"],
    )


@tool(
    name="meetings_get_summary",
    description="Get the AI-generated summary for a meeting",
    integration="meetings",
    method="GET",
    path="/{meeting_id}/summary",
)
async def meetings_get_summary(inp: MeetingIdInput) -> dict:
    """Get the AI-generated summary for a meeting."""
    meeting_id = inp.meeting_id
    pool = get_pool()
    r = await pool.fetchrow(
        "SELECT summary, status FROM meetings WHERE id = $1",
        uuid.UUID(meeting_id),
    )
    if not r:
        return {"error": "Meeting not found"}
    return {"summary": r["summary"] or "", "status": r["status"]}


@tool(
    name="meetings_get_actions",
    description="Get the AI-extracted action items for a meeting",
    integration="meetings",
    method="GET",
    path="/{meeting_id}/actions",
)
async def meetings_get_actions(inp: MeetingIdInput) -> dict:
    """Get the AI-extracted action items for a meeting."""
    meeting_id = inp.meeting_id
    pool = get_pool()
    r = await pool.fetchrow(
        "SELECT action_items, status FROM meetings WHERE id = $1",
        uuid.UUID(meeting_id),
    )
    if not r:
        return {"error": "Meeting not found"}
    return {
        "action_items": json.loads(r["action_items"]) if r["action_items"] else [],
        "status": r["status"],
    }
