"""
Shared HTTP helpers for agent tools — handles OAuth token retrieval
and HTTP calls to external APIs.
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)


async def _slack_api(method: str, *, params: dict | None = None, json_body: dict | None = None):
    """Call Slack API via the shared slack_client helper (handles OAuth token)."""
    from services.slack_client import _slack
    return await _slack(method, params=params, json_body=json_body)


async def _github_api(method: str, path: str, *, params: dict | None = None, json: dict | None = None):
    """Call GitHub API via the shared github_client helper (handles OAuth token)."""
    from services.github_client import _gh
    return await _gh(method, path, params=params, json=json)


async def _jira_api(method: str, path: str, *, params: dict | None = None, json: dict | None = None):
    """Call Jira/Atlassian API via the shared jira_client helper (handles OAuth token)."""
    from services.jira_client import _jira
    return await _jira(method, path, params=params, json=json)
