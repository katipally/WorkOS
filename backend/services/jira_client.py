"""
Jira HTTP client — shared helpers for the Jira router.

Wraps Jira REST API v3 (Atlassian Cloud) calls with retry,
rate-limit handling, and OAuth token management.
"""

import asyncio
import json
import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

from services.oauth_service import get_valid_access_token, get_token, save_token

logger = logging.getLogger(__name__)

_cloud_id_cache: dict[str, str] = {}


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return isinstance(exc, (httpx.TimeoutException, httpx.ConnectError))


async def _jira_base() -> tuple[str, str]:
    """Return (cloud_base_url, access_token) for Jira API calls.

    IMPORTANT: OAuth 3LO tokens MUST be used via the Atlassian API proxy
    (https://api.atlassian.com/ex/jira/{cloud_id}), NOT the instance URL
    (e.g. https://foo.atlassian.net).  The instance URL rejects Bearer tokens.
    """
    token = await get_valid_access_token("atlassian")
    if not token:
        raise ValueError("Jira (Atlassian) is not connected. Go to Settings → Integrations to connect.")
    row = await get_token("atlassian")
    meta = row.get("meta", {}) if row else {}
    if isinstance(meta, str):
        meta = json.loads(meta or "{}")
    # Always resolve via cloud_id — never use the instance URL directly
    cloud_id = meta.get("cloud_id", "") or _cloud_id_cache.get("atlassian", "")
    if not cloud_id:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://api.atlassian.com/oauth/token/accessible-resources",
                    headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                )
                resp.raise_for_status()
                resources = resp.json()
                if resources:
                    cloud_id = resources[0]["id"]
                    _cloud_id_cache["atlassian"] = cloud_id
                    await save_token("atlassian", token,
                                     refresh_token=row.get("refresh_token") if row else None,
                                     scope=row.get("scope") if row else None,
                                     meta={**meta, "cloud_id": cloud_id})
        except Exception as e:
            logger.warning("[jira] could not fetch cloud_id: %s", e)
    if not cloud_id:
        raise ValueError("Could not determine Jira Cloud ID. Reconnect Jira in Settings → Integrations.")
    return f"https://api.atlassian.com/ex/jira/{cloud_id}", token


async def get_jira_site_url() -> str:
    """Return the Jira instance URL (e.g. https://foo.atlassian.net) for building browse links."""
    row = await get_token("atlassian")
    if not row:
        return ""
    meta = row.get("meta", {})
    if isinstance(meta, str):
        meta = json.loads(meta or "{}")
    return (meta.get("cloud_url") or "").rstrip("/")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8),
       retry=retry_if_exception(_is_retryable), reraise=True)
async def _jira(method: str, path: str, *, params: dict | None = None, json_body: Any = None) -> Any:
    base, token = await _jira_base()
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"}
    url = f"{base}/rest/api/3{path}"
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=30.0)) as client:
        resp = await client.request(method, url, headers=headers, params=params, json=json_body)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "5"))
            logger.warning("[jira] rate limited, retry-after=%ds", retry_after)
            await asyncio.sleep(retry_after)
            resp.raise_for_status()
        resp.raise_for_status()
        if resp.status_code == 204:
            return {}
        return resp.json()


def _format_issue(i: dict, site_url: str = "") -> dict:
    f = i.get("fields", {})
    key = i.get("key", "")
    url = f"{site_url}/browse/{key}" if site_url and key else ""
    return {
        "key": key, "id": i.get("id"),
        "summary": f.get("summary", ""),
        "status": f.get("status", {}).get("name", ""),
        "priority": f.get("priority", {}).get("name", "") if f.get("priority") else "",
        "issue_type": f.get("issuetype", {}).get("name", "") if f.get("issuetype") else "",
        "assignee": f.get("assignee", {}).get("displayName", "") if f.get("assignee") else "Unassigned",
        "labels": f.get("labels", []),
        "created": f.get("created", ""), "updated": f.get("updated", ""),
        "url": url,
    }


def _extract_text(body) -> str:
    """Extract plain text from Atlassian Document Format (ADF) body."""
    if not body or not isinstance(body, dict):
        return ""
    texts = []
    for block in body.get("content", []):
        for inline in block.get("content", []):
            if inline.get("type") == "text":
                texts.append(inline.get("text", ""))
    return " ".join(texts)
