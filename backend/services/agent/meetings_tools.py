"""
Meetings & RAG agent tools — LangChain @tool definitions for meetings and data search.

READ tools: list, get details, get summary, get actions, search, get transcript
WRITE tools: create, attach file, process, delete, update action items
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid as _uuid
from datetime import datetime
from typing import Optional

from langchain_core.tools import tool

from db.connection import get_pool

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# MEETINGS — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def meetings_list() -> str:
    """List all meetings, most recent first. Returns id, title, date, status, and summary preview."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT id, title, meeting_date, status, summary FROM meetings ORDER BY meeting_date DESC LIMIT 20"
    )
    if not rows:
        return "No meetings found."
    results = [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "date": str(r["meeting_date"]),
            "status": r["status"],
            "summary_preview": (r["summary"] or "")[:200],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


@tool
async def meetings_get_details(meeting_id: str) -> str:
    """Get full meeting details including all files, transcriptions, summary, and action items."""
    pool = get_pool()
    r = await pool.fetchrow(
        """SELECT m.*, COALESCE(
               json_agg(
                   json_build_object(
                       'id', mf.id::text,
                       'filename', mf.filename,
                       'filetype', mf.filetype,
                       'filesize', mf.filesize,
                       'status', mf.status,
                       'transcription', LEFT(mf.transcription, 500)
                   )
               ) FILTER (WHERE mf.id IS NOT NULL), '[]'::json
           ) AS files
           FROM meetings m
           LEFT JOIN meeting_files mf ON mf.meeting_id = m.id
           WHERE m.id = $1
           GROUP BY m.id""",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    return json.dumps({
        "id": str(r["id"]),
        "title": r["title"],
        "description": r["description"],
        "meeting_date": str(r["meeting_date"]),
        "status": r["status"],
        "summary": r["summary"] or "",
        "action_items": json.loads(r["action_items"]) if r["action_items"] else [],
        "error": r["error"],
        "files": json.loads(r["files"]) if isinstance(r["files"], str) else r["files"],
    }, indent=2, default=str)


@tool
async def meetings_get_summary(meeting_id: str) -> str:
    """Get the AI-generated summary for a specific meeting."""
    pool = get_pool()
    r = await pool.fetchrow(
        "SELECT title, summary, status FROM meetings WHERE id = $1",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    return json.dumps({
        "title": r["title"],
        "status": r["status"],
        "summary": r["summary"] or "No summary generated yet.",
    }, indent=2)


@tool
async def meetings_get_actions(meeting_id: str) -> str:
    """Get the AI-extracted action items for a specific meeting."""
    pool = get_pool()
    r = await pool.fetchrow(
        "SELECT title, action_items, status FROM meetings WHERE id = $1",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    items = json.loads(r["action_items"]) if r["action_items"] else []
    return json.dumps({"title": r["title"], "action_items": items}, indent=2)


@tool
async def meetings_get_transcript(meeting_id: str) -> str:
    """Get the full transcript text for a meeting (from all transcribed files)."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT filename, transcription FROM meeting_files
           WHERE meeting_id = $1 AND transcription IS NOT NULL AND transcription != ''
           ORDER BY created_at""",
        _uuid.UUID(meeting_id),
    )
    if not rows:
        return "No transcript available for this meeting."
    parts = []
    for r in rows:
        parts.append(f"[{r['filename']}]\n{r['transcription']}")
    return "\n\n".join(parts)


@tool
async def meeting_search(query: str, limit: int = 5) -> str:
    """Search meetings by keyword across titles and summaries."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, title, summary, action_items, meeting_date
           FROM meetings
           WHERE status = 'ready'
             AND (title ILIKE $1 OR summary ILIKE $1)
           ORDER BY meeting_date DESC LIMIT $2""",
        f"%{query}%", limit,
    )
    if not rows:
        return f"No meetings found matching '{query}'."
    results = [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "date": str(r["meeting_date"]),
            "summary": (r["summary"] or "")[:500],
            "action_items": json.loads(r["action_items"]) if r["action_items"] else [],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# MEETINGS — WRITE (approval-gated where appropriate)
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def meetings_create(title: str, description: str = "", meeting_date: str = "") -> str:
    """Create a new meeting. Returns the created meeting's ID and details.
    The meeting_date should be in ISO format (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS).
    If meeting_date is empty, the current date/time is used."""
    pool = get_pool()
    date = datetime.fromisoformat(meeting_date) if meeting_date else datetime.utcnow()
    r = await pool.fetchrow(
        """INSERT INTO meetings (title, description, meeting_date)
           VALUES ($1, $2, $3) RETURNING *""",
        title, description, date,
    )
    return json.dumps({
        "id": str(r["id"]),
        "title": r["title"],
        "description": r["description"],
        "meeting_date": str(r["meeting_date"]),
        "status": r["status"],
        "message": f"Meeting '{r['title']}' created successfully.",
    }, indent=2, default=str)


@tool
async def meetings_attach_uploaded_file(meeting_id: str, filename: str) -> str:
    """Attach a file that was uploaded in the AI chat to a meeting.
    The filename should match the name of a file the user uploaded in this conversation
    (e.g., 'recording.mp3', 'transcript.txt'). The system will find the most recently
    uploaded document with that name and copy it to the meeting."""
    pool = get_pool()
    from config import settings

    # Find the most recently uploaded document with this filename
    doc = await pool.fetchrow(
        """SELECT id, filename, filepath, filetype, filesize
           FROM documents
           WHERE filename = $1 AND source_type = 'upload'
           ORDER BY created_at DESC LIMIT 1""",
        filename,
    )
    if not doc:
        return json.dumps({"error": f"No uploaded file found with name '{filename}'. Make sure the file was uploaded first."})

    src_path = doc["filepath"]
    if not src_path or not os.path.exists(src_path):
        return json.dumps({"error": f"Upload file not found on disk for '{filename}'."})

    # Copy file to meeting directory
    from services.transcription_service import is_audio_video, is_transcript

    ext = os.path.splitext(filename)[1].lower()
    if is_audio_video(filename):
        filetype = "audio" if ext in {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".wma"} else "video"
    elif is_transcript(filename):
        filetype = "transcript"
    else:
        filetype = "document"

    upload_dir = os.path.join(settings.UPLOAD_DIR, "meetings", meeting_id)
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(_uuid.uuid4())
    dest_path = os.path.join(upload_dir, f"{file_id}{ext}")

    import shutil
    shutil.copy2(src_path, dest_path)

    # Read file size
    filesize = os.path.getsize(dest_path)

    # Insert meeting file record
    r = await pool.fetchrow(
        """INSERT INTO meeting_files (meeting_id, filename, filetype, filesize, filepath, mime_type)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *""",
        _uuid.UUID(meeting_id), filename, filetype, filesize, dest_path, "",
    )

    return json.dumps({
        "file_id": str(r["id"]),
        "meeting_id": meeting_id,
        "filename": filename,
        "filetype": filetype,
        "filesize": filesize,
        "message": f"File '{filename}' attached to meeting successfully.",
    }, indent=2)


@tool
async def meetings_process(meeting_id: str) -> str:
    """Trigger AI processing for a meeting: transcribe audio/video, generate summary, and extract action items.
    The meeting must have at least one file attached. Processing runs in the background."""
    pool = get_pool()

    # Verify meeting exists and has files
    meeting = await pool.fetchrow("SELECT id, title, status FROM meetings WHERE id = $1", _uuid.UUID(meeting_id))
    if not meeting:
        return json.dumps({"error": "Meeting not found."})

    file_count = await pool.fetchval(
        "SELECT COUNT(*) FROM meeting_files WHERE meeting_id = $1", _uuid.UUID(meeting_id)
    )
    if file_count == 0:
        return json.dumps({"error": "No files attached to this meeting. Upload a file first."})

    # Trigger processing
    from tools.meetings.process import process_meeting_pipeline
    asyncio.create_task(process_meeting_pipeline(meeting_id))

    return json.dumps({
        "meeting_id": meeting_id,
        "title": meeting["title"],
        "message": f"Processing started for '{meeting['title']}'. This will transcribe audio/video, generate a summary, and extract action items. Check the meeting status for progress.",
    }, indent=2)


@tool
async def meetings_delete(meeting_id: str) -> str:
    """Delete a meeting and all its files permanently. This cannot be undone."""
    pool = get_pool()

    meeting = await pool.fetchrow("SELECT id, title FROM meetings WHERE id = $1", _uuid.UUID(meeting_id))
    if not meeting:
        return json.dumps({"error": "Meeting not found."})

    # Delete physical files
    files = await pool.fetch(
        "SELECT filepath FROM meeting_files WHERE meeting_id = $1",
        _uuid.UUID(meeting_id),
    )
    for f in files:
        try:
            if f["filepath"] and os.path.exists(f["filepath"]):
                os.remove(f["filepath"])
        except Exception:
            pass

    await pool.execute("DELETE FROM meetings WHERE id = $1", _uuid.UUID(meeting_id))
    return json.dumps({
        "message": f"Meeting '{meeting['title']}' deleted successfully.",
    })


@tool
async def meetings_update_action_item(
    meeting_id: str,
    item_index: int,
    completed: Optional[bool] = None,
    assignee: Optional[str] = None,
    due_date: Optional[str] = None,
    text: Optional[str] = None,
) -> str:
    """Update a specific action item in a meeting. The item_index is 0-based.
    You can update any combination of: completed status, assignee, due_date, or text."""
    pool = get_pool()
    r = await pool.fetchrow(
        "SELECT action_items FROM meetings WHERE id = $1", _uuid.UUID(meeting_id)
    )
    if not r:
        return json.dumps({"error": "Meeting not found."})

    items = json.loads(r["action_items"]) if r["action_items"] else []
    if item_index < 0 or item_index >= len(items):
        return json.dumps({"error": f"Invalid item index {item_index}. Meeting has {len(items)} action items (0-indexed)."})

    item = items[item_index]
    if completed is not None:
        item["completed"] = completed
    if assignee is not None:
        item["assignee"] = assignee
    if due_date is not None:
        item["due_date"] = due_date
    if text is not None:
        item["text"] = text
    items[item_index] = item

    await pool.execute(
        "UPDATE meetings SET action_items = $2, updated_at = NOW() WHERE id = $1",
        _uuid.UUID(meeting_id), json.dumps(items),
    )

    return json.dumps({
        "message": f"Action item #{item_index} updated.",
        "item": item,
    }, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# RAG — Semantic search over all indexed data & documents
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def rag_search(query: str, source_filter: Optional[str] = None, top_k: int = 5) -> str:
    """Semantic search across all indexed documents and app data using RAG.
    source_filter can be: 'document', 'slack_message', 'github_issue', 'github_pr', 'meeting'.
    Returns the most relevant chunks with their source and score."""
    try:
        from services.rag_service import search_documents

        results = await search_documents(query, top_k=top_k, source_filter=source_filter)
        if not results:
            return "No relevant documents found."
        return json.dumps(results, indent=2, default=str)
    except Exception as e:
        return f"RAG search failed: {e}"


@tool
async def db_query_data(source_type: str, query: str, limit: int = 10) -> str:
    """Search the indexed data store (data_index table) by source type and keyword.
    source_type: 'slack_message', 'github_issue', 'github_pr', 'meeting'.
    query: Text search keyword.
    This is useful for finding specific indexed data when RAG semantic search
    is too broad."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT title, content, source_type, entity_id, metadata
           FROM data_index
           WHERE source_type = $1 AND (title ILIKE $2 OR content ILIKE $2)
           ORDER BY indexed_at DESC LIMIT $3""",
        source_type, f"%{query}%", limit,
    )
    if not rows:
        return f"No indexed data found for source_type='{source_type}' matching '{query}'."
    results = [
        {
            "title": r["title"],
            "content": r["content"][:500],
            "source_type": r["source_type"],
            "entity_id": r["entity_id"],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


# ─── Export lists ─────────────────────────────────────────────────────────────

MEETINGS_TOOLS = [
    # Read tools
    meetings_list,
    meetings_get_details,
    meetings_get_summary,
    meetings_get_actions,
    meetings_get_transcript,
    meeting_search,
    # Write tools (some are approval-gated via config.py)
    meetings_create,
    meetings_attach_uploaded_file,
    meetings_process,
    meetings_delete,
    meetings_update_action_item,
]

RAG_TOOLS = [
    rag_search,
    db_query_data,
]
