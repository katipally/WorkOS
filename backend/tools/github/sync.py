"""
GitHub sync tools — pull repos from the GitHub API and upsert into
the local DB so that list queries are fast.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import HTTPException
import httpx

from db.connection import get_db_pool
from services.github_client import _gh
from tools import tool
from tools.github.models import GitHubRepo

logger = logging.getLogger(__name__)


# ── helpers ────────────────────────────────────────────────────────────────

def _parse_dt(val: str | None) -> datetime | None:
    """Parse ISO-8601 strings (e.g. '2026-02-18T01:19:15Z') into datetime.
    asyncpg requires real datetime objects for TIMESTAMPTZ columns."""
    if not val:
        return None
    try:
        return datetime.fromisoformat(val.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def _gh_exc(e: Exception) -> HTTPException:
    """Convert a GitHub/httpx error into a FastAPI HTTPException."""
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        try:
            detail = e.response.json().get("message", str(e))
        except Exception:
            detail = str(e)
        # Map GitHub 4xx/5xx → 502 (bad gateway) so our routing stays clean.
        # Exception: 401/403 pass through for auth-related signals.
        if status in (401, 403):
            return HTTPException(status_code=status, detail=detail)
        return HTTPException(status_code=502, detail=f"GitHub API {status}: {detail}")
    if isinstance(e, ValueError) and "not connected" in str(e).lower():
        return HTTPException(status_code=401, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


# ── sync repos ────────────────────────────────────────────────────────────

@tool(
    name="github_sync_repos",
    description="Sync GitHub repos to local DB",
    integration="github",
    method="POST",
    path="/repos/sync",
)
async def github_sync_repos(inp) -> list[GitHubRepo]:
    """Fetch repos from GitHub API and upsert into github_repos table."""
    try:
        data = await _gh(
            "GET",
            "/user/repos",
            params={"per_page": 50, "sort": "updated", "affiliation": "owner,collaborator"},
        )
    except Exception as e:
        raise _gh_exc(e)

    repos: list[GitHubRepo] = []
    pool = await get_db_pool()

    for r in data:
        repo = GitHubRepo(
            id=r["id"],
            full_name=r["full_name"],
            name=r["name"],
            description=r.get("description"),
            language=r.get("language"),
            stars=r["stargazers_count"],
            forks=r["forks_count"],
            open_issues=r["open_issues_count"],
            is_private=r["private"],
            html_url=r["html_url"],
            default_branch=r["default_branch"],
            updated_at=r["updated_at"],
        )
        repos.append(repo)
        await pool.execute(
            """INSERT INTO github_repos
                (id, full_name, name, description, language, stars, forks,
                 open_issues, is_private, html_url, default_branch, updated_at, synced_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
               ON CONFLICT (id) DO UPDATE SET
                   full_name      = EXCLUDED.full_name,
                   name           = EXCLUDED.name,
                   description    = EXCLUDED.description,
                   language       = EXCLUDED.language,
                   stars          = EXCLUDED.stars,
                   forks          = EXCLUDED.forks,
                   open_issues    = EXCLUDED.open_issues,
                   is_private     = EXCLUDED.is_private,
                   html_url       = EXCLUDED.html_url,
                   default_branch = EXCLUDED.default_branch,
                   updated_at     = EXCLUDED.updated_at,
                   synced_at      = NOW()""",
            repo.id, repo.full_name, repo.name, repo.description or "",
            repo.language or "", repo.stars, repo.forks, repo.open_issues,
            repo.is_private, repo.html_url, repo.default_branch,
            _parse_dt(repo.updated_at),
        )

    logger.info("[github_sync_repos] upserted %d repos", len(repos))

    # Index repo metadata into RAG data_index (background, non-blocking)
    try:
        from services.rag_service import index_data

        for repo in repos:
            content = f"GitHub repo {repo.full_name}"
            if repo.description:
                content += f" — {repo.description}"
            if repo.language:
                content += f" (language: {repo.language})"
            content += f" | stars: {repo.stars}, forks: {repo.forks}, open issues: {repo.open_issues}"
            await index_data(
                source_type="github_repo",
                entity_id=str(repo.id),
                title=repo.full_name,
                content=content,
                metadata={
                    "full_name": repo.full_name,
                    "language": repo.language or "",
                    "html_url": repo.html_url,
                    "is_private": repo.is_private,
                },
            )
        logger.info("[github_sync_repos] indexed %d repos for RAG", len(repos))
    except Exception as e:
        logger.warning("[github_sync_repos] RAG indexing failed (non-fatal): %s", e)

    return repos
