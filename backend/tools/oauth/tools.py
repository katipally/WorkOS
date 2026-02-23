"""
OAuth tools — status check and disconnect.

authorize/callback endpoints stay in the manual OAuthRouter because they
return HTML, handle redirects, and don't fit the tool pattern.
"""

from __future__ import annotations

import httpx
from fastapi import HTTPException

from config import settings
from services.oauth_service import (
    delete_token,
    get_connection_status,
    get_valid_access_token,
)
from tools import tool
from tools.base import EmptyInput
from tools.oauth import DisconnectInput, DisconnectOutput, OAuthStatusOutput, ProviderStatus


# ── status ────────────────────────────────────────────────────────────────

@tool(
    name="oauth_status",
    description="Check connection status for all OAuth providers",
    integration="oauth",
    method="GET",
    path="/status",
)
async def oauth_status(inp: EmptyInput) -> OAuthStatusOutput:
    raw = await get_connection_status()
    return OAuthStatusOutput(
        github=ProviderStatus(**raw.get("github", {})),
        slack=ProviderStatus(**raw.get("slack", {})),
        atlassian=ProviderStatus(**raw.get("atlassian", {})),
    )


# ── disconnect ────────────────────────────────────────────────────────────

@tool(
    name="oauth_disconnect",
    description="Revoke and delete OAuth token for a provider",
    integration="oauth",
    method="DELETE",
    path="/{provider}/disconnect",
    idempotent=False,
)
async def oauth_disconnect(inp: DisconnectInput) -> DisconnectOutput:
    if inp.provider not in ("github", "slack", "atlassian"):
        raise HTTPException(status_code=400, detail="Unknown provider")

    token_val = await get_valid_access_token(inp.provider)

    # Best-effort revocation
    try:
        if inp.provider == "github" and token_val:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.request(
                    "DELETE",
                    f"https://api.github.com/applications/{settings.GITHUB_CLIENT_ID}/token",
                    auth=(settings.GITHUB_CLIENT_ID, settings.GITHUB_CLIENT_SECRET),
                    json={"access_token": token_val},
                )
        elif inp.provider == "slack" and token_val:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    "https://slack.com/api/auth.revoke",
                    headers={"Authorization": f"Bearer {token_val}"},
                )
        elif inp.provider == "atlassian" and token_val:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    "https://auth.atlassian.com/oauth/token/revoke",
                    json={
                        "token": token_val,
                        "client_id": settings.ATLASSIAN_CLIENT_ID,
                        "client_secret": settings.ATLASSIAN_CLIENT_SECRET,
                    },
                )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("[oauth] Revocation warning for %s: %s", inp.provider, e)

    await delete_token(inp.provider)
    return DisconnectOutput(ok=True, provider=inp.provider)
