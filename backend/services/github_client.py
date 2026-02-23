"""
GitHub HTTP client — shared helper for the GitHub router.

Wraps GitHub REST API v3 calls with retry, rate-limit handling, and token management.
"""

import asyncio
import logging
from typing import Any

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

from services.oauth_service import get_valid_access_token

logger = logging.getLogger(__name__)

_GITHUB_API = "https://api.github.com"
_HEADERS_BASE = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return isinstance(exc, (httpx.TimeoutException, httpx.ConnectError))


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8),
       retry=retry_if_exception(_is_retryable), reraise=True)
async def _gh(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> Any:
    token = await get_valid_access_token("github")
    if not token:
        raise ValueError("GitHub is not connected. Go to Settings → Integrations to connect.")
    headers = {**_HEADERS_BASE, "Authorization": f"token {token}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=30.0)) as client:
        resp = await client.request(method, f"{_GITHUB_API}{path}", headers=headers, params=params, json=json)
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", "5"))
            logger.warning("[github] rate limited, retry-after=%ds", retry_after)
            await asyncio.sleep(retry_after)
            resp.raise_for_status()
        resp.raise_for_status()
        if resp.status_code == 204:
            return {}
        return resp.json()
