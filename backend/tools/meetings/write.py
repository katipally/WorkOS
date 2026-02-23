"""
Meeting write tools — create, upload, delete, process.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel
from tools import tool
from tools.meetings.models import MeetingCreate, MeetingIdInput, MeetingOut, MeetingFileOut
from db.connection import get_pool
from config import settings

log = logging.getLogger(__name__)


@tool(
    name="meetings_create_meeting",
    description="Create a new meeting",
    integration="meetings",
    method="POST",
    path="/",
    idempotent=False,
)
async def meetings_create_meeting(body: MeetingCreate) -> MeetingOut:
    """Create a new meeting."""
    pool = get_pool()
    meeting_date = body.meeting_date or datetime.utcnow().isoformat()
    r = await pool.fetchrow(
        """INSERT INTO meetings (title, description, meeting_date)
           VALUES ($1, $2, $3) RETURNING *""",
        body.title, body.description, datetime.fromisoformat(meeting_date),
    )
    return MeetingOut(
        id=str(r["id"]),
        title=r["title"],
        description=r["description"],
        meeting_date=r["meeting_date"].isoformat(),
        status=r["status"],
        created_at=r["created_at"].isoformat(),
        updated_at=r["updated_at"].isoformat(),
    )


@tool(
    name="meetings_delete_meeting",
    description="Delete a meeting and all its files",
    integration="meetings",
    method="DELETE",
    path="/{meeting_id}",
    idempotent=False,
)
async def meetings_delete_meeting(inp: MeetingIdInput) -> dict:
    """Delete a meeting and all its files."""
    meeting_id = inp.meeting_id
    pool = get_pool()

    # Delete physical files
    files = await pool.fetch(
        "SELECT filepath FROM meeting_files WHERE meeting_id = $1",
        uuid.UUID(meeting_id),
    )
    for f in files:
        try:
            if f["filepath"] and os.path.exists(f["filepath"]):
                os.remove(f["filepath"])
        except Exception:
            pass

    await pool.execute("DELETE FROM meetings WHERE id = $1", uuid.UUID(meeting_id))
    return {"ok": True}


class MeetingFileIdInput(BaseModel):
    meeting_id: str
    file_id: str


@tool(
    name="meetings_delete_file",
    description="Delete a single uploaded file from a meeting",
    integration="meetings",
    method="DELETE",
    path="/{meeting_id}/files/{file_id}",
    idempotent=False,
)
async def meetings_delete_file(inp: MeetingFileIdInput) -> dict:
    """Delete a single uploaded file from a meeting."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT filepath FROM meeting_files WHERE id = $1 AND meeting_id = $2",
        uuid.UUID(inp.file_id), uuid.UUID(inp.meeting_id),
    )
    if not row:
        return {"ok": False, "error": "File not found"}
    try:
        if row["filepath"] and os.path.exists(row["filepath"]):
            os.remove(row["filepath"])
    except Exception:
        pass
    await pool.execute("DELETE FROM meeting_files WHERE id = $1", uuid.UUID(inp.file_id))
    return {"ok": True}


# Note: NOT a @tool — binary file content cannot be auto-routed.
# The HTTP endpoint is mounted explicitly in main.py.
async def meetings_upload_file(meeting_id: str, filename: str, content: bytes, mime_type: str = "") -> MeetingFileOut:
    """Upload a file to a meeting (transcript, audio, or video)."""
    pool = get_pool()

    # Determine filetype
    from services.transcription_service import is_audio_video, is_transcript

    ext = os.path.splitext(filename)[1].lower()
    if is_audio_video(filename):
        filetype = "audio" if ext in {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma"} else "video"
    elif is_transcript(filename):
        filetype = "transcript"
    else:
        filetype = "document"

    # Save file
    upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", meeting_id)
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    filepath = os.path.join(upload_dir, f"{file_id}{ext}")

    with open(filepath, "wb") as f:
        f.write(content)

    r = await pool.fetchrow(
        """INSERT INTO meeting_files (meeting_id, filename, filetype, filesize, filepath, mime_type)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
        uuid.UUID(meeting_id), filename, filetype, len(content), filepath, mime_type,
    )

    return MeetingFileOut(
        id=str(r["id"]),
        meeting_id=meeting_id,
        filename=r["filename"],
        filetype=r["filetype"],
        filesize=r["filesize"],
        mime_type=r["mime_type"],
        status=r["status"],
    )


@tool(
    name="meetings_process_meeting",
    description="Trigger AI processing of a meeting: transcribe, summarise, extract action items",
    integration="meetings",
    method="POST",
    path="/{meeting_id}/process",
    idempotent=False,
)
async def meetings_process_meeting(inp: MeetingIdInput) -> dict:
    """Trigger AI processing of a meeting: transcribe audio/video, extract summary & action items."""
    from tools.meetings.process import process_meeting_pipeline

    # Run in background
    asyncio.create_task(process_meeting_pipeline(inp.meeting_id))
    return {"ok": True, "message": "Processing started"}
