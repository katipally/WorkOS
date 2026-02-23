"""
OAuth 2.0 authorization flows for GitHub, Slack, and Atlassian (Jira).

This router handles ONLY the authorize / callback endpoints that return
HTML or redirect.  Status and disconnect are tool-based (see tools/oauth/).
"""

import urllib.parse
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse

from config import settings
from services.oauth_service import (
    generate_state, consume_state,
    save_token,
)

router = APIRouter()

# ── Redirect URIs (backend handles the callback, not the frontend) ────────────
def _redirect_uri(provider: str) -> str:
    return f"{settings.APP_BASE_URL}/api/oauth/{provider}/callback"


# ── HTML helper: close popup and post message to opener ──────────────────────
def _popup_close(success: bool, provider: str, error: str = "") -> HTMLResponse:
    import html as html_mod
    safe_provider = html_mod.escape(provider)
    safe_error = html_mod.escape(error)
    msg = "connected" if success else f"error:{safe_error}"
    display_msg = "Connected! You may close this window." if success else f"Error: {safe_error}"
    html = f"""<!DOCTYPE html><html><body>
<script>
  if (window.opener) {{
    window.opener.postMessage({{type:'oauth_callback',provider:'{safe_provider}',status:'{msg}'}}, '*');
    window.close();
  }} else {{
    document.body.innerText = '{display_msg}';
  }}
</script></body></html>"""
    return HTMLResponse(html)


# ══════════════════════════════════════════════════════════════════════════════
# GITHUB
# ══════════════════════════════════════════════════════════════════════════════

GITHUB_SCOPES = "repo,read:org,read:user,user:email"


@router.get("/github/authorize")
async def github_authorize():
    if not settings.GITHUB_CLIENT_ID:
        raise HTTPException(
            status_code=501,
            detail="GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
        )
    state = await generate_state("github")
    params = urllib.parse.urlencode({
        "client_id": settings.GITHUB_CLIENT_ID,
        "redirect_uri": _redirect_uri("github"),
        "scope": GITHUB_SCOPES,
        "state": state,
        "allow_signup": "false",
    })
    return {"url": f"https://github.com/login/oauth/authorize?{params}"}


@router.get("/github/callback")
async def github_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error:
        return _popup_close(False, "github", error)

    provider = await consume_state(state or "")
    if provider != "github":
        return _popup_close(False, "github", "invalid_state")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.GITHUB_CLIENT_ID,
                    "client_secret": settings.GITHUB_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": _redirect_uri("github"),
                },
            )
            resp.raise_for_status()
            data = resp.json()

        if "error" in data:
            return _popup_close(False, "github", data.get("error_description", data["error"]))

        access_token = data["access_token"]

        # Fetch user info to store in meta
        async with httpx.AsyncClient(timeout=10) as client:
            user_resp = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            user_data = user_resp.json() if user_resp.is_success else {}

        await save_token(
            provider="github",
            access_token=access_token,
            token_type=data.get("token_type", "Bearer"),
            scope=data.get("scope"),
            meta={"login": user_data.get("login"), "name": user_data.get("name")},
        )
        return _popup_close(True, "github")

    except Exception as e:
        return _popup_close(False, "github", str(e))


# ══════════════════════════════════════════════════════════════════════════════
# SLACK
# ══════════════════════════════════════════════════════════════════════════════

SLACK_SCOPES = "channels:read,channels:history,chat:write,users:read,team:read"


@router.get("/slack/authorize")
async def slack_authorize():
    if not settings.SLACK_CLIENT_ID:
        raise HTTPException(
            status_code=501,
            detail="Slack OAuth not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.",
        )
    state = await generate_state("slack")
    params = urllib.parse.urlencode({
        "client_id": settings.SLACK_CLIENT_ID,
        "scope": SLACK_SCOPES,
        "redirect_uri": _redirect_uri("slack"),
        "state": state,
    })
    return {"url": f"https://slack.com/oauth/v2/authorize?{params}"}


@router.get("/slack/callback")
async def slack_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error:
        return _popup_close(False, "slack", error)

    provider = await consume_state(state or "")
    if provider != "slack":
        return _popup_close(False, "slack", "invalid_state")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://slack.com/api/oauth.v2.access",
                data={
                    "client_id": settings.SLACK_CLIENT_ID,
                    "client_secret": settings.SLACK_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": _redirect_uri("slack"),
                },
            )
            resp.raise_for_status()
            data = resp.json()

        if not data.get("ok"):
            return _popup_close(False, "slack", data.get("error", "unknown"))

        bot_token = data["access_token"]
        team = data.get("team", {})
        authed_user = data.get("authed_user", {})

        await save_token(
            provider="slack",
            access_token=bot_token,
            token_type="Bearer",
            scope=data.get("scope"),
            meta={
                "team_id": team.get("id"),
                "team_name": team.get("name"),
                "bot_user_id": data.get("bot_user_id"),
                "authed_user_id": authed_user.get("id"),
            },
        )
        return _popup_close(True, "slack")

    except Exception as e:
        return _popup_close(False, "slack", str(e))


# ══════════════════════════════════════════════════════════════════════════════
# ATLASSIAN (Jira)
# ══════════════════════════════════════════════════════════════════════════════

ATLASSIAN_SCOPES = (
    "read:jira-work read:jira-user write:jira-work manage:jira-project offline_access"
)


@router.get("/atlassian/authorize")
async def atlassian_authorize():
    if not settings.ATLASSIAN_CLIENT_ID:
        raise HTTPException(
            status_code=501,
            detail="Atlassian OAuth not configured. Set ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET.",
        )
    state = await generate_state("atlassian")
    params = urllib.parse.urlencode({
        "audience": "api.atlassian.com",
        "client_id": settings.ATLASSIAN_CLIENT_ID,
        "scope": ATLASSIAN_SCOPES,
        "redirect_uri": _redirect_uri("atlassian"),
        "state": state,
        "response_type": "code",
        "prompt": "consent",
    })
    return {"url": f"https://auth.atlassian.com/authorize?{params}"}


@router.get("/atlassian/callback")
async def atlassian_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error:
        return _popup_close(False, "atlassian", error)

    provider = await consume_state(state or "")
    if provider != "atlassian":
        return _popup_close(False, "atlassian", "invalid_state")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            token_resp = await client.post(
                "https://auth.atlassian.com/oauth/token",
                json={
                    "grant_type": "authorization_code",
                    "client_id": settings.ATLASSIAN_CLIENT_ID,
                    "client_secret": settings.ATLASSIAN_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": _redirect_uri("atlassian"),
                },
            )
            token_resp.raise_for_status()
            token_data = token_resp.json()

        access_token = token_data["access_token"]

        # Fetch accessible Jira cloud resources
        async with httpx.AsyncClient(timeout=10) as client:
            sites_resp = await client.get(
                "https://api.atlassian.com/oauth/token/accessible-resources",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            sites = sites_resp.json() if sites_resp.is_success else []

        # Use first site as default
        primary_site = sites[0] if sites else {}

        await save_token(
            provider="atlassian",
            access_token=access_token,
            refresh_token=token_data.get("refresh_token"),
            token_type=token_data.get("token_type", "Bearer"),
            scope=token_data.get("scope"),
            expires_in=token_data.get("expires_in"),
            meta={
                "cloud_id": primary_site.get("id"),
                "cloud_url": primary_site.get("url"),
                "cloud_name": primary_site.get("name"),
                "all_sites": [{"id": s.get("id"), "url": s.get("url"), "name": s.get("name")} for s in sites],
            },
        )
        return _popup_close(True, "atlassian")

    except Exception as e:
        return _popup_close(False, "atlassian", str(e))
