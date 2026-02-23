"""
Jira sync tools — pull projects from the Jira API and upsert into
the local DB so that list queries are fast.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException
import httpx

from db.connection import get_db_pool
from services.jira_client import _jira
from tools import tool
from tools.jira.models import JiraProject

logger = logging.getLogger(__name__)


# ── helpers ────────────────────────────────────────────────────────────────

def _jira_exc(e: Exception) -> HTTPException:
    """Convert a Jira/httpx error into a FastAPI HTTPException."""
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        try:
            detail = e.response.json().get("errorMessages", [str(e)])[0]
        except Exception:
            detail = str(e)
        return HTTPException(status_code=status if status < 600 else 502, detail=detail)
    if isinstance(e, ValueError) and "not connected" in str(e).lower():
        return HTTPException(status_code=401, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


# ── sync projects ─────────────────────────────────────────────────────────

@tool(
    name="jira_sync_projects",
    description="Sync Jira projects to local DB",
    integration="jira",
    method="POST",
    path="/projects/sync",
)
async def jira_sync_projects(inp) -> list[JiraProject]:
    """Fetch projects from Jira API and upsert into jira_projects table."""
    try:
        data = await _jira("GET", "/project/search", params={"maxResults": 50})
    except Exception as e:
        raise _jira_exc(e)

    projects: list[JiraProject] = []
    pool = await get_db_pool()

    for p in data.get("values", []):
        proj = JiraProject(
            key=p["key"],
            name=p["name"],
            id=p["id"],
            type=p.get("projectTypeKey", ""),
            avatar=p.get("avatarUrls", {}).get("48x48", ""),
        )
        projects.append(proj)
        await pool.execute(
            """INSERT INTO jira_projects (id, key, name, type, avatar_url, synced_at)
               VALUES ($1, $2, $3, $4, $5, NOW())
               ON CONFLICT (id) DO UPDATE SET
                   key        = EXCLUDED.key,
                   name       = EXCLUDED.name,
                   type       = EXCLUDED.type,
                   avatar_url = EXCLUDED.avatar_url,
                   synced_at  = NOW()""",
            proj.id, proj.key, proj.name, proj.type, proj.avatar,
        )

    logger.info("[jira_sync_projects] upserted %d projects", len(projects))
    return projects
