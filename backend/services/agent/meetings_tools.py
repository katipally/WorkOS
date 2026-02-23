"""
Meetings & RAG agent tools — LangChain @tool definitions for meetings and data search.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from langchain_core.tools import tool

from db.connection import get_pool

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# MEETINGS — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def meetings_list() -> str:
    """List all meetings, most recent first."""
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
async def meetings_get_summary(meeting_id: str) -> str:
    """Get the AI-generated summary for a specific meeting."""
    pool = get_pool()
    import uuid as _uuid

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
    import uuid as _uuid

    r = await pool.fetchrow(
        "SELECT title, action_items, status FROM meetings WHERE id = $1",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    items = json.loads(r["action_items"]) if r["action_items"] else []
    return json.dumps({"title": r["title"], "action_items": items}, indent=2)


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
    meetings_list,
    meetings_get_summary,
    meetings_get_actions,
    meeting_search,
]

RAG_TOOLS = [
    rag_search,
    db_query_data,
]
