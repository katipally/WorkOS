"""
OAuth 2.0 token management service.

Handles storage, retrieval, and refresh of access tokens for:
  - GitHub  (OAuth App — authorization_code flow, non-expiring tokens)
  - Slack   (OAuth v2 — bot token, non-expiring unless revoked)
  - Atlassian/Jira (3LO — authorization_code + refresh_token, 1h expiry)
"""

import json
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from db.connection import get_pool
from config import settings

log = logging.getLogger(__name__)


# ── DB-backed state store (safe for multi-worker deployments) ────────────────

async def generate_state(provider: str) -> str:
    """Generate a cryptographic state token and persist it in the DB.

    Tokens expire after 10 minutes.
    """
    state = secrets.token_urlsafe(32)
    pool = get_pool()
    await pool.execute(
        """INSERT INTO oauth_pending_states (state, provider)
           VALUES ($1, $2)""",
        state, provider,
    )
    # Opportunistic cleanup of expired states (non-blocking)
    await pool.execute(
        "DELETE FROM oauth_pending_states WHERE expires_at < NOW()"
    )
    return state


async def consume_state(state: str) -> Optional[str]:
    """Validate and consume a state token. Returns provider name or None.

    The token is deleted on consumption (one-time use). Expired tokens
    are rejected.
    """
    pool = get_pool()
    row = await pool.fetchrow(
        """DELETE FROM oauth_pending_states
           WHERE state = $1 AND expires_at > NOW()
           RETURNING provider""",
        state,
    )
    return row["provider"] if row else None


# ── DB helpers ────────────────────────────────────────────────────────────────

async def save_token(
    provider: str,
    access_token: str,
    refresh_token: Optional[str] = None,
    token_type: str = "Bearer",
    scope: Optional[str] = None,
    expires_in: Optional[int] = None,   # seconds
    meta: Optional[dict] = None,
) -> None:
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO oauth_tokens
                (provider, access_token, refresh_token, token_type, scope, expires_at, meta, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
            ON CONFLICT (provider) DO UPDATE SET
                access_token  = EXCLUDED.access_token,
                refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_tokens.refresh_token),
                token_type    = EXCLUDED.token_type,
                scope         = EXCLUDED.scope,
                expires_at    = EXCLUDED.expires_at,
                meta          = COALESCE(EXCLUDED.meta, oauth_tokens.meta),
                updated_at    = NOW()
            """,
            provider,
            access_token,
            refresh_token,
            token_type,
            scope,
            expires_at,
            json.dumps(meta) if meta is not None else None,
        )


async def get_token(provider: str) -> Optional[dict]:
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM oauth_tokens WHERE provider=$1", provider
        )
    if not row:
        return None
    return dict(row)


async def delete_token(provider: str) -> None:
    pool = get_pool()
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM oauth_tokens WHERE provider=$1", provider)


async def get_valid_access_token(provider: str) -> Optional[str]:
    """Return a valid access token, refreshing if expired (Atlassian only)."""
    row = await get_token(provider)
    if not row:
        return None

    access_token: str = row["access_token"]
    expires_at = row.get("expires_at")
    refresh_token = row.get("refresh_token")

    # If token is not expiring or still valid, return as-is
    if not expires_at:
        return access_token

    now = datetime.now(timezone.utc)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    # Refresh if within 5 minutes of expiry
    if expires_at - now > timedelta(minutes=5):
        return access_token

    if provider == "atlassian" and refresh_token:
        return await _refresh_atlassian_token(refresh_token)

    return None  # expired and can't refresh


async def _refresh_atlassian_token(refresh_token: str) -> Optional[str]:
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://auth.atlassian.com/oauth/token",
                json={
                    "grant_type": "refresh_token",
                    "client_id": settings.ATLASSIAN_CLIENT_ID,
                    "client_secret": settings.ATLASSIAN_CLIENT_SECRET,
                    "refresh_token": refresh_token,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        await save_token(
            provider="atlassian",
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token", refresh_token),
            expires_in=data.get("expires_in"),
            scope=data.get("scope"),
        )
        return data["access_token"]
    except Exception as e:
        print(f"[oauth] Atlassian token refresh failed: {e}")
        return None


async def get_connection_status() -> dict[str, dict]:
    """Return connected/disconnected status for all providers."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT provider, scope, meta, expires_at, updated_at FROM oauth_tokens"
        )

    result: dict[str, dict] = {
        "github":    {"connected": False},
        "slack":     {"connected": False},
        "atlassian": {"connected": False},
    }
    for row in rows:
        provider = row["provider"]
        meta = row["meta"] if isinstance(row["meta"], dict) else json.loads(row["meta"] or "{}")
        expires_at = row["expires_at"]
        expired = False
        if expires_at:
            now = datetime.now(timezone.utc)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            expired = expires_at < now

        result[provider] = {
            "connected": not expired,
            "scope": row["scope"],
            "meta": meta,
            "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        }

    return result
