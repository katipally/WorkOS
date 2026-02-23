"""
Slack HTTP client — shared helper for the Slack router.

Wraps Slack Web API calls with retry, rate-limit handling, and token management.
"""

import asyncio
import logging
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception

from services.oauth_service import get_valid_access_token

logger = logging.getLogger(__name__)

_SLACK_API = "https://slack.com/api"


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in (429, 500, 502, 503, 504)
    return isinstance(exc, (httpx.TimeoutException, httpx.ConnectError))


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8),
       retry=retry_if_exception(_is_retryable), reraise=True)
async def _slack(method: str, params: dict | None = None, json_body: dict | None = None) -> dict:
    token = await get_valid_access_token("slack")
    if not token:
        raise ValueError("Slack is not connected. Go to Settings → Integrations to connect.")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=30.0)) as client:
        if json_body is not None:
            resp = await client.post(f"{_SLACK_API}/{method}", headers=headers, json=json_body)
        else:
            resp = await client.get(f"{_SLACK_API}/{method}", headers=headers, params=params or {})
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", "5"))
        logger.warning("[slack] rate limited, retry-after=%ds", retry_after)
        await asyncio.sleep(retry_after)
        resp.raise_for_status()
    resp.raise_for_status()
    data = resp.json()
    if not data.get("ok"):
        raise ValueError(f"Slack API error [{method}]: {data.get('error', 'unknown')}")
    return data
