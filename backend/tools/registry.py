"""
Auto-route generator.

Reads every tool from ``ToolRegistry`` and creates a FastAPI route for it.
GET tools with ``cache_ttl`` consult the ``tool_cache`` DB table first.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from tools import ToolMeta, ToolRegistry

logger = logging.getLogger(__name__)

# ── Route-path prefix per integration ──────────────────────────────────────

_PREFIX = {
    "github": "/api/github",
    "slack": "/api/slack",
    "jira": "/api/jira",
    "oauth": "/api/oauth",
    "meetings": "/api/meetings",
    "settings": "/api/settings",
    "system": "/api",
}


# ── Cache helpers ──────────────────────────────────────────────────────────

def _cache_key(tool_name: str, params: dict[str, Any]) -> str:
    """Deterministic cache key from tool name + params."""
    raw = json.dumps(params, sort_keys=True, default=str)
    return hashlib.sha256(f"{tool_name}:{raw}".encode()).hexdigest()[:32]


async def _get_cached(pool, tool_name: str, key: str) -> dict | None:
    row = await pool.fetchrow(
        """SELECT result, cached_at FROM tool_cache
           WHERE tool_name = $1 AND cache_key = $2
             AND expires_at > NOW()""",
        tool_name,
        key,
    )
    if row:
        return {"result": json.loads(row["result"]), "cached_at": row["cached_at"]}
    return None


async def _set_cached(pool, tool_name: str, key: str, result: Any, ttl: int) -> None:
    data = json.dumps(result, default=str)
    await pool.execute(
        """INSERT INTO tool_cache (tool_name, cache_key, result, cached_at, expires_at)
           VALUES ($1, $2, $3::jsonb, NOW(), NOW() + make_interval(secs => $4))
           ON CONFLICT (tool_name, cache_key)
           DO UPDATE SET result = EXCLUDED.result,
                         cached_at = EXCLUDED.cached_at,
                         expires_at = EXCLUDED.expires_at""",
        tool_name,
        key,
        data,
        ttl,
    )


# ── Route builder ────────────────────────────────────────────────────────

def _build_handler(meta: ToolMeta, fn):
    """Return an async handler that FastAPI can mount as a route."""

    InputModel = meta.input_model

    if meta.method == "GET":
        # GET: parse query params into the Input model
        async def get_handler(request: Request):
            try:
                from db.connection import get_db_pool

                params = dict(request.query_params)
                # Also merge path params (normalise {repo_name} → repo)
                pp = dict(request.path_params)
                if "repo_name" in pp:
                    pp["repo"] = pp.pop("repo_name")
                params.update(pp)

                if InputModel and InputModel is not None:
                    inp = InputModel(**params)
                else:
                    from tools.base import EmptyInput
                    inp = EmptyInput()

                # Cache check
                if meta.cache_ttl:
                    pool = await get_db_pool()
                    ck = _cache_key(meta.name, params)
                    cached = await _get_cached(pool, meta.name, ck)
                    if cached:
                        return cached["result"]

                result = await fn(inp)

                # Serialise Pydantic model to dict
                if isinstance(result, BaseModel):
                    result = result.model_dump(mode="json")
                elif isinstance(result, list) and result and isinstance(result[0], BaseModel):
                    result = [r.model_dump(mode="json") for r in result]

                # Cache write
                if meta.cache_ttl:
                    pool = await get_db_pool()
                    ck = _cache_key(meta.name, params)
                    await _set_cached(pool, meta.name, ck, result, meta.cache_ttl)

                return result
            except HTTPException:
                raise
            except Exception as e:
                logger.exception("[tool:%s] error", meta.name)
                raise HTTPException(status_code=500, detail=str(e))

        get_handler.__name__ = meta.name
        get_handler.__doc__ = meta.description
        return get_handler

    else:
        # POST / PATCH / PUT / DELETE: parse JSON body into Input model
        async def mutate_handler(request: Request):
            try:
                params = dict(request.path_params)
                # Normalise {repo_name} → repo
                if "repo_name" in params:
                    params["repo"] = params.pop("repo_name")
                # Also merge query params (needed for DELETE with query strings)
                params.update(dict(request.query_params))

                if InputModel and InputModel is not None:
                    body = await request.json() if await request.body() else {}
                    merged = {**body, **params}
                    inp = InputModel(**merged)
                else:
                    from tools.base import EmptyInput
                    inp = EmptyInput()

                result = await fn(inp)

                if isinstance(result, BaseModel):
                    result = result.model_dump(mode="json")
                elif isinstance(result, list) and result and isinstance(result[0], BaseModel):
                    result = [r.model_dump(mode="json") for r in result]

                return result
            except HTTPException:
                raise
            except Exception as e:
                logger.exception("[tool:%s] error", meta.name)
                raise HTTPException(status_code=500, detail=str(e))

        mutate_handler.__name__ = meta.name
        mutate_handler.__doc__ = meta.description
        return mutate_handler


# ── Public mount function ─────────────────────────────────────────────────

def mount_tools(app: FastAPI, reg: ToolRegistry) -> None:
    """Create FastAPI routes for every tool in the registry."""

    for name, (meta, fn) in reg.all().items():
        prefix = _PREFIX.get(meta.integration, "/api")
        full_path = f"{prefix}{meta.path}"
        handler = _build_handler(meta, fn)
        methods = [meta.method]

        app.add_api_route(
            full_path,
            handler,
            methods=methods,
            tags=list(meta.tags),  # type: ignore[arg-type]
            summary=meta.description,
            name=meta.name,
        )
        logger.info("[mount] %s %s → %s", meta.method, full_path, name)

    logger.info("[mount] %d tools mounted", len(reg))
