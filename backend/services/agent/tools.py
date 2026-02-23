"""
Agent tool definitions for LangGraph — comprehensive bridge to ALL WorkOS tools.

Every tool is a LangChain ``@tool`` that the agent can invoke.  Tools use the
module-level ``_slack()`` and ``_gh()`` HTTP helpers (which handle OAuth token
refresh, retry, and rate-limiting) so the agent never bypasses auth.

DB queries use the correct column names from the migration schema:
  • slack_channels: channel_id, channel_name, is_private, num_members, topic, purpose
  • slack_users: user_id, name, display_name, is_bot
  • github_repos: id, full_name, name, description, language, stars, forks, …
  • tool_cache: tool_name, cache_key, result, cached_at, expires_at
  • meetings: id, title, description, meeting_date, status, summary, action_items
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional

from langchain_core.tools import tool

from db.connection import get_pool

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# SLACK — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def slack_list_channels() -> str:
    """List all synced Slack channels with their names and IDs.
    Returns channel_id and channel_name for each channel."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT channel_id, channel_name, is_private, num_members, topic "
        "FROM slack_channels ORDER BY channel_name"
    )
    if not rows:
        return "No Slack channels synced yet. The user should connect Slack in Settings first, then sync channels."
    channels = [
        {
            "id": r["channel_id"],
            "name": r["channel_name"],
            "private": r["is_private"],
            "members": r["num_members"],
            "topic": r["topic"][:100] if r["topic"] else "",
        }
        for r in rows
    ]
    return json.dumps(channels, indent=2)


@tool
async def slack_list_users() -> str:
    """List all synced Slack workspace members."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT user_id, name, display_name, is_bot FROM slack_users ORDER BY name"
    )
    if not rows:
        return "No Slack users synced yet."
    users = [
        {"id": r["user_id"], "name": r["name"], "display_name": r["display_name"], "is_bot": r["is_bot"]}
        for r in rows
    ]
    return json.dumps(users, indent=2)


@tool
async def slack_get_channel_messages(channel_id: str, hours: int = 24, limit: int = 50) -> str:
    """Fetch recent messages from a Slack channel.
    channel_id: The Slack channel ID (e.g. C0123456789).
    hours: How many hours back to fetch (default 24, 0 for all).
    limit: Max messages to return (default 50, max 200)."""
    try:
        from services.slack_client import _slack

        params: dict = {"channel": channel_id, "limit": min(limit, 200)}
        if hours > 0:
            params["oldest"] = str(time.time() - hours * 3600)
        data = await _slack("conversations.history", params=params)
        messages = data.get("messages", [])
        results = []
        for m in reversed(messages):
            if m.get("subtype") in ("channel_join", "channel_leave"):
                continue
            results.append({
                "ts": m["ts"],
                "user": m.get("user", m.get("username", "bot")),
                "text": m.get("text", "")[:500],
                "reply_count": m.get("reply_count", 0),
                "thread_ts": m.get("thread_ts"),
            })
        if not results:
            return f"No messages found in channel {channel_id} in the last {hours} hours."
        return json.dumps(results[:limit], indent=2)
    except Exception as e:
        return f"Failed to fetch channel messages: {e}"


@tool
async def slack_get_thread(channel_id: str, thread_ts: str) -> str:
    """Fetch all replies in a specific Slack thread.
    channel_id: The channel containing the thread.
    thread_ts: The timestamp of the parent message."""
    try:
        from services.slack_client import _slack

        data = await _slack(
            "conversations.replies",
            params={"channel": channel_id, "ts": thread_ts, "limit": 100},
        )
        msgs = data.get("messages", [])
        results = [
            {"ts": m["ts"], "user": m.get("user", "bot"), "text": m.get("text", "")[:500]}
            for m in msgs
        ]
        return json.dumps(results, indent=2)
    except Exception as e:
        return f"Failed to fetch thread: {e}"


@tool
async def slack_search_messages(query: str, channel_name: Optional[str] = None) -> str:
    """Search Slack messages across channels by keyword using the live Slack API.
    query: The search term.
    channel_name: Optional channel name to restrict search (without #)."""
    try:
        from services.slack_client import _slack

        search_q = f"in:#{channel_name} {query}" if channel_name else query
        data = await _slack("search.messages", params={"query": search_q, "count": 20, "sort": "timestamp"})
        matches = data.get("messages", {}).get("matches", [])
        if not matches:
            return f"No Slack messages found matching '{query}'."
        results = [
            {
                "channel": m.get("channel", {}).get("name", ""),
                "user": m.get("username", m.get("user", "")),
                "text": m.get("text", "")[:500],
                "ts": m["ts"],
                "permalink": m.get("permalink", ""),
            }
            for m in matches
        ]
        return json.dumps(results, indent=2)
    except Exception as e:
        return f"Failed to search Slack messages: {e}"


@tool
async def slack_get_channel_info(channel_id: str) -> str:
    """Get detailed info for a specific Slack channel including topic, purpose, member count."""
    try:
        from services.slack_client import _slack

        data = await _slack("conversations.info", params={"channel": channel_id, "include_num_members": "true"})
        c = data.get("channel", {})
        info = {
            "id": c["id"],
            "name": c.get("name", ""),
            "topic": c.get("topic", {}).get("value", ""),
            "purpose": c.get("purpose", {}).get("value", ""),
            "num_members": c.get("num_members", 0),
            "is_private": c.get("is_private", False),
        }
        return json.dumps(info, indent=2)
    except Exception as e:
        return f"Failed to get channel info: {e}"


@tool
async def slack_get_pins(channel_id: str) -> str:
    """List pinned messages in a Slack channel."""
    try:
        from services.slack_client import _slack

        data = await _slack("pins.list", params={"channel": channel_id})
        items = data.get("items", [])
        pins = [
            {
                "ts": i.get("message", {}).get("ts", ""),
                "user": i.get("message", {}).get("user", ""),
                "text": i.get("message", {}).get("text", "")[:500],
            }
            for i in items
            if i.get("type") == "message"
        ]
        return json.dumps(pins, indent=2) if pins else "No pinned messages in this channel."
    except Exception as e:
        return f"Failed to get pins: {e}"


@tool
async def slack_get_user_presence(user_id: str) -> str:
    """Check if a Slack user is currently online."""
    try:
        from services.slack_client import _slack

        data = await _slack("users.getPresence", params={"user": user_id})
        return json.dumps({
            "user_id": user_id,
            "presence": data.get("presence", "unknown"),
            "online": data.get("online", False),
        })
    except Exception as e:
        return f"Failed to get user presence: {e}"


@tool
async def slack_list_files(channel_id: Optional[str] = None, count: int = 20) -> str:
    """List files shared in Slack. Optionally filter by channel_id."""
    try:
        from services.slack_client import _slack

        params: dict = {"count": min(count, 100)}
        if channel_id:
            params["channel"] = channel_id
        data = await _slack("files.list", params=params)
        files = [
            {
                "id": f["id"],
                "name": f.get("name", ""),
                "filetype": f.get("filetype", ""),
                "size": f.get("size", 0),
                "user": f.get("user", ""),
                "permalink": f.get("permalink", ""),
            }
            for f in data.get("files", [])
        ]
        return json.dumps(files, indent=2) if files else "No files found."
    except Exception as e:
        return f"Failed to list files: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# SLACK — WRITE (these require approval)
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def slack_send_message(channel_id: str, text: str, thread_ts: Optional[str] = None) -> str:
    """Send a message to a Slack channel. Optionally reply in a thread.
    channel_id: Target channel ID.
    text: Message text to send.
    thread_ts: If replying to a thread, the parent message timestamp."""
    try:
        from services.slack_client import _slack

        payload: dict = {"channel": channel_id, "text": text}
        if thread_ts:
            payload["thread_ts"] = thread_ts
        data = await _slack("chat.postMessage", json_body=payload)
        return f"Message sent successfully (ts={data.get('ts', '')})."
    except Exception as e:
        return f"Failed to send Slack message: {e}"


@tool
async def slack_send_dm(user_id: str, text: str) -> str:
    """Send a direct message to a Slack user.
    user_id: The Slack user ID to message.
    text: Message text to send."""
    try:
        from services.slack_client import _slack

        open_data = await _slack("conversations.open", json_body={"users": user_id})
        channel_id = open_data["channel"]["id"]
        data = await _slack("chat.postMessage", json_body={"channel": channel_id, "text": text})
        return f"DM sent successfully to {user_id} (ts={data.get('ts', '')})."
    except Exception as e:
        return f"Failed to send DM: {e}"


@tool
async def slack_add_reaction(channel_id: str, timestamp: str, emoji: str) -> str:
    """Add an emoji reaction to a Slack message.
    emoji: The emoji name without colons (e.g. 'thumbsup')."""
    try:
        from services.slack_client import _slack

        await _slack("reactions.add", json_body={
            "channel": channel_id, "timestamp": timestamp, "name": emoji.strip(":"),
        })
        return f"Added :{emoji.strip(':')}:  reaction."
    except Exception as e:
        return f"Failed to add reaction: {e}"


@tool
async def slack_pin_message(channel_id: str, timestamp: str) -> str:
    """Pin a message in a Slack channel."""
    try:
        from services.slack_client import _slack

        await _slack("pins.add", json_body={"channel": channel_id, "timestamp": timestamp})
        return "Message pinned successfully."
    except Exception as e:
        return f"Failed to pin message: {e}"


@tool
async def slack_schedule_message(channel_id: str, text: str, post_at: int) -> str:
    """Schedule a message to be sent later.
    post_at: Unix timestamp for when the message should be sent."""
    try:
        from services.slack_client import _slack

        data = await _slack("chat.scheduleMessage", json_body={
            "channel": channel_id, "text": text, "post_at": post_at,
        })
        return f"Message scheduled (id={data.get('scheduled_message_id', '')})."
    except Exception as e:
        return f"Failed to schedule message: {e}"


@tool
async def slack_edit_message(channel_id: str, ts: str, text: str) -> str:
    """Edit an existing Slack message.
    ts: The timestamp of the message to edit.
    text: The new message text."""
    try:
        from services.slack_client import _slack

        await _slack("chat.update", json_body={"channel": channel_id, "ts": ts, "text": text})
        return "Message edited successfully."
    except Exception as e:
        return f"Failed to edit message: {e}"


@tool
async def slack_delete_message(channel_id: str, ts: str) -> str:
    """Delete a Slack message.
    ts: The timestamp of the message to delete."""
    try:
        from services.slack_client import _slack

        await _slack("chat.delete", json_body={"channel": channel_id, "ts": ts})
        return "Message deleted successfully."
    except Exception as e:
        return f"Failed to delete message: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# GITHUB — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def github_list_repos() -> str:
    """List all synced GitHub repositories."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT full_name, description, language, stars, forks, open_issues, is_private, default_branch "
        "FROM github_repos ORDER BY full_name"
    )
    if not rows:
        return "No GitHub repos synced. Connect GitHub in Settings and sync repos first."
    repos = [
        {
            "full_name": r["full_name"],
            "description": (r["description"] or "")[:200],
            "language": r["language"],
            "stars": r["stars"],
            "forks": r["forks"],
            "open_issues": r["open_issues"],
            "private": r["is_private"],
        }
        for r in rows
    ]
    return json.dumps(repos, indent=2)


@tool
async def github_list_issues(repo: str, state: str = "open", assignee: Optional[str] = None, label: Optional[str] = None, days: int = 0) -> str:
    """List issues for a GitHub repo. repo format: owner/repo.
    state: 'open', 'closed', or 'all'.
    assignee: Filter by assignee login.
    label: Filter by label name.
    days: Only show issues updated in last N days (0=all)."""
    try:
        from services.github_client import _gh

        params: dict = {"state": state, "per_page": 50, "sort": "updated", "direction": "desc"}
        if assignee:
            params["assignee"] = assignee
        if label:
            params["labels"] = label
        if days > 0:
            from datetime import datetime, timedelta, timezone
            params["since"] = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

        items = await _gh("GET", f"/repos/{repo}/issues", params=params)
        results = [
            {
                "number": i["number"], "title": i["title"], "state": i["state"],
                "url": i["html_url"],
                "assignee": i["assignee"]["login"] if i.get("assignee") else None,
                "labels": [lb["name"] for lb in i.get("labels", [])],
                "updated_at": i["updated_at"],
            }
            for i in items
            if "pull_request" not in i
        ]
        if not results:
            return f"No issues found in {repo} with state={state}."
        return json.dumps(results[:30], indent=2, default=str)
    except Exception as e:
        return f"Failed to list issues: {e}"


@tool
async def github_get_issue_detail(repo: str, number: int) -> str:
    """Get full details for a GitHub issue including body and comments.
    repo: owner/repo format.
    number: The issue number."""
    try:
        from services.github_client import _gh
        import asyncio

        issue, comments = await asyncio.gather(
            _gh("GET", f"/repos/{repo}/issues/{number}"),
            _gh("GET", f"/repos/{repo}/issues/{number}/comments"),
        )
        result = {
            "number": issue["number"], "title": issue["title"], "state": issue["state"],
            "body": (issue.get("body") or "")[:2000], "url": issue["html_url"],
            "assignee": issue["assignee"]["login"] if issue.get("assignee") else None,
            "labels": [lb["name"] for lb in issue.get("labels", [])],
            "comments": [
                {"author": c["user"]["login"], "body": c["body"][:500], "date": c["created_at"]}
                for c in (comments or [])[-10:]
            ],
        }
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return f"Failed to get issue detail: {e}"


@tool
async def github_list_pull_requests(repo: str, state: str = "open") -> str:
    """List pull requests for a GitHub repo.
    repo: owner/repo format.
    state: 'open', 'closed', or 'all'."""
    try:
        from services.github_client import _gh

        items = await _gh("GET", f"/repos/{repo}/pulls", params={
            "state": state, "per_page": 30, "sort": "updated",
        })
        results = [
            {
                "number": p["number"], "title": p["title"], "state": p["state"],
                "url": p["html_url"], "author": p["user"]["login"],
                "base": p["base"]["ref"], "head": p["head"]["ref"],
                "draft": p.get("draft", False),
                "reviewers": [r["login"] for r in p.get("requested_reviewers", [])],
            }
            for p in items
        ]
        if not results:
            return f"No pull requests found in {repo} with state={state}."
        return json.dumps(results[:20], indent=2, default=str)
    except Exception as e:
        return f"Failed to list PRs: {e}"


@tool
async def github_get_pr_detail(repo: str, number: int) -> str:
    """Get full PR details including reviews and changed files.
    repo: owner/repo format.
    number: The PR number."""
    try:
        from services.github_client import _gh
        import asyncio

        pr, reviews, files = await asyncio.gather(
            _gh("GET", f"/repos/{repo}/pulls/{number}"),
            _gh("GET", f"/repos/{repo}/pulls/{number}/reviews"),
            _gh("GET", f"/repos/{repo}/pulls/{number}/files", params={"per_page": 30}),
        )
        result = {
            "number": pr["number"], "title": pr["title"], "state": pr["state"],
            "body": (pr.get("body") or "")[:2000], "url": pr["html_url"],
            "author": pr["user"]["login"], "mergeable": pr.get("mergeable"),
            "base": pr["base"]["ref"], "head": pr["head"]["ref"],
            "reviews": [
                {"reviewer": r["user"]["login"], "state": r["state"], "body": (r.get("body") or "")[:200]}
                for r in (reviews or [])
            ],
            "changed_files": [
                {"file": f["filename"], "status": f["status"], "+": f["additions"], "-": f["deletions"]}
                for f in (files or [])[:30]
            ],
        }
        return json.dumps(result, indent=2, default=str)
    except Exception as e:
        return f"Failed to get PR detail: {e}"


@tool
async def github_list_commits(repo: str, days: int = 7, author: Optional[str] = None) -> str:
    """List recent commits for a GitHub repo.
    repo: owner/repo format.
    days: How many days back (default 7, 0 for all).
    author: Filter by author login."""
    try:
        from services.github_client import _gh

        params: dict = {"per_page": 50}
        if days > 0:
            from datetime import datetime, timedelta, timezone
            params["since"] = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        if author:
            params["author"] = author
        items = await _gh("GET", f"/repos/{repo}/commits", params=params)
        commits = [
            {
                "sha": c["sha"][:8],
                "message": c["commit"]["message"].split("\n")[0][:200],
                "author": c["commit"]["author"]["name"],
                "date": c["commit"]["author"]["date"],
            }
            for c in items
        ]
        return json.dumps(commits[:30], indent=2, default=str)
    except Exception as e:
        return f"Failed to list commits: {e}"


@tool
async def github_list_branches(repo: str) -> str:
    """List branches for a GitHub repo. repo: owner/repo format."""
    try:
        from services.github_client import _gh

        items = await _gh("GET", f"/repos/{repo}/branches", params={"per_page": 50})
        branches = [
            {"name": b["name"], "sha": b["commit"]["sha"][:8], "protected": b.get("protected", False)}
            for b in items
        ]
        return json.dumps(branches, indent=2)
    except Exception as e:
        return f"Failed to list branches: {e}"


@tool
async def github_get_actions(repo: str) -> str:
    """Get recent CI/CD workflow runs from GitHub Actions. repo: owner/repo format."""
    try:
        from services.github_client import _gh

        data = await _gh("GET", f"/repos/{repo}/actions/runs", params={"per_page": 15})
        runs = data.get("workflow_runs", []) if isinstance(data, dict) else []
        results = [
            {
                "id": r["id"], "name": r["name"], "status": r["status"],
                "conclusion": r.get("conclusion"), "branch": r["head_branch"],
                "url": r["html_url"],
            }
            for r in runs
        ]
        return json.dumps(results, indent=2, default=str)
    except Exception as e:
        return f"Failed to get actions: {e}"


@tool
async def github_read_file(repo: str, path: str, ref: str = "main") -> str:
    """Read a file from a GitHub repository. Returns the file content.
    repo: owner/repo format.
    path: Path to the file (e.g. 'src/main.py').
    ref: Branch, tag, or commit SHA (default: main)."""
    try:
        from services.github_client import _gh
        import base64

        data = await _gh("GET", f"/repos/{repo}/contents/{path}", params={"ref": ref})
        if isinstance(data, list):
            entries = [{"name": e["name"], "type": e["type"]} for e in data]
            return json.dumps(entries, indent=2)
        content = data.get("content", "")
        encoding = data.get("encoding", "")
        if encoding == "base64" and content:
            return base64.b64decode(content).decode("utf-8", errors="replace")[:50000]
        return content if content else f"File not found: {path}"
    except Exception as e:
        return f"Failed to read file: {e}"


@tool
async def github_search_code(query: str, repo: Optional[str] = None) -> str:
    """Search code across GitHub repos. Optionally restrict to a specific repo (owner/repo)."""
    try:
        from services.github_client import _gh

        q = f"{query} repo:{repo}" if repo else query
        data = await _gh("GET", "/search/code", params={"q": q, "per_page": 15})
        items = data.get("items", []) if isinstance(data, dict) else []
        results = [
            {"path": i["path"], "repo": i["repository"]["full_name"], "url": i.get("html_url", "")}
            for i in items
        ]
        return json.dumps(results, indent=2) if results else f"No code results for '{query}'."
    except Exception as e:
        return f"Failed to search code: {e}"


@tool
async def github_get_notifications() -> str:
    """Get the user's unread GitHub notifications."""
    try:
        from services.github_client import _gh

        items = await _gh("GET", "/notifications", params={"all": "false", "per_page": 20})
        results = [
            {
                "type": n["subject"]["type"], "title": n["subject"]["title"],
                "repo": n["repository"]["full_name"], "updated_at": n["updated_at"],
            }
            for n in items
        ]
        return json.dumps(results, indent=2) if results else "No unread notifications."
    except Exception as e:
        return f"Failed to get notifications: {e}"


@tool
async def github_get_readme(repo: str) -> str:
    """Get the README content of a GitHub repo. repo: owner/repo format."""
    try:
        from services.github_client import _gh
        import base64

        data = await _gh("GET", f"/repos/{repo}/readme")
        if data.get("encoding") == "base64" and data.get("content"):
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")[:20000]
        return "No README found."
    except Exception as e:
        return f"Failed to get README: {e}"


@tool
async def github_list_labels(repo: str) -> str:
    """List all labels in a GitHub repo. repo: owner/repo format."""
    try:
        from services.github_client import _gh

        items = await _gh("GET", f"/repos/{repo}/labels", params={"per_page": 100})
        labels = [{"name": lb["name"], "color": lb.get("color", ""), "description": lb.get("description", "")} for lb in items]
        return json.dumps(labels, indent=2)
    except Exception as e:
        return f"Failed to list labels: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# GITHUB — WRITE (these require approval)
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def github_create_issue(repo: str, title: str, body: str = "", labels: str = "", assignee: str = "") -> str:
    """Create a new GitHub issue. repo format: owner/repo.
    labels: Comma-separated label names.
    assignee: GitHub username to assign."""
    try:
        from services.github_client import _gh

        payload: dict = {"title": title, "body": body}
        if labels:
            payload["labels"] = [lb.strip() for lb in labels.split(",") if lb.strip()]
        if assignee:
            payload["assignees"] = [assignee]
        issue = await _gh("POST", f"/repos/{repo}/issues", json=payload)
        return f"Issue #{issue['number']} created: {issue['html_url']}"
    except Exception as e:
        return f"Failed to create issue: {e}"


@tool
async def github_create_branch(repo: str, branch: str, from_branch: str = "") -> str:
    """Create a new Git branch. repo format: owner/repo.
    branch: Name of the new branch.
    from_branch: Source branch (defaults to repo default branch)."""
    try:
        from services.github_client import _gh

        repo_data = await _gh("GET", f"/repos/{repo}")
        base = from_branch or repo_data["default_branch"]
        ref_data = await _gh("GET", f"/repos/{repo}/git/ref/heads/{base}")
        sha = ref_data["object"]["sha"]
        await _gh("POST", f"/repos/{repo}/git/refs", json={"ref": f"refs/heads/{branch}", "sha": sha})
        return f"Branch '{branch}' created from '{base}' (sha={sha[:8]})."
    except Exception as e:
        return f"Failed to create branch: {e}"


@tool
async def github_submit_pr_review(repo: str, number: int, event: str, body: str = "") -> str:
    """Submit a review on a GitHub pull request.
    repo: owner/repo format.
    number: PR number.
    event: 'APPROVE', 'REQUEST_CHANGES', or 'COMMENT'."""
    try:
        from services.github_client import _gh

        data = await _gh("POST", f"/repos/{repo}/pulls/{number}/reviews", json={
            "event": event.upper(), "body": body,
        })
        return f"Review submitted (state={data['state']})."
    except Exception as e:
        return f"Failed to submit review: {e}"


@tool
async def github_merge_pr(repo: str, number: int, merge_method: str = "merge", commit_title: str = "") -> str:
    """Merge a GitHub pull request.
    repo: owner/repo format.
    number: PR number.
    merge_method: 'merge', 'squash', or 'rebase'."""
    try:
        from services.github_client import _gh

        payload: dict = {"merge_method": merge_method}
        if commit_title:
            payload["commit_title"] = commit_title
        data = await _gh("PUT", f"/repos/{repo}/pulls/{number}/merge", json=payload)
        merged = data.get("merged", False)
        return f"PR #{number} {'merged' if merged else 'not merged'}: {data.get('message', '')}."
    except Exception as e:
        return f"Failed to merge PR: {e}"


@tool
async def github_create_release(repo: str, tag_name: str, name: str = "", body: str = "", draft: bool = False, prerelease: bool = False) -> str:
    """Create a new release in a GitHub repo. repo: owner/repo format."""
    try:
        from services.github_client import _gh

        data = await _gh("POST", f"/repos/{repo}/releases", json={
            "tag_name": tag_name, "name": name or tag_name, "body": body,
            "draft": draft, "prerelease": prerelease,
        })
        return f"Release created: {data['html_url']}"
    except Exception as e:
        return f"Failed to create release: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# MEETINGS — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def meetings_list() -> str:
    """List all meetings, most recent first."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT id, title, meeting_date, status, summary FROM meetings ORDER BY meeting_date DESC LIMIT 20"
    )
    if not rows:
        return "No meetings found."
    results = [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "date": str(r["meeting_date"]),
            "status": r["status"],
            "summary_preview": (r["summary"] or "")[:200],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


@tool
async def meetings_get_summary(meeting_id: str) -> str:
    """Get the AI-generated summary for a specific meeting."""
    pool = get_pool()
    import uuid as _uuid

    r = await pool.fetchrow(
        "SELECT title, summary, status FROM meetings WHERE id = $1",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    return json.dumps({
        "title": r["title"],
        "status": r["status"],
        "summary": r["summary"] or "No summary generated yet.",
    }, indent=2)


@tool
async def meetings_get_actions(meeting_id: str) -> str:
    """Get the AI-extracted action items for a specific meeting."""
    pool = get_pool()
    import uuid as _uuid

    r = await pool.fetchrow(
        "SELECT title, action_items, status FROM meetings WHERE id = $1",
        _uuid.UUID(meeting_id),
    )
    if not r:
        return "Meeting not found."
    items = json.loads(r["action_items"]) if r["action_items"] else []
    return json.dumps({"title": r["title"], "action_items": items}, indent=2)


@tool
async def meeting_search(query: str, limit: int = 5) -> str:
    """Search meetings by keyword across titles and summaries."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, title, summary, action_items, meeting_date
           FROM meetings
           WHERE status = 'ready'
             AND (title ILIKE $1 OR summary ILIKE $1)
           ORDER BY meeting_date DESC LIMIT $2""",
        f"%{query}%", limit,
    )
    if not rows:
        return f"No meetings found matching '{query}'."
    results = [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "date": str(r["meeting_date"]),
            "summary": (r["summary"] or "")[:500],
            "action_items": json.loads(r["action_items"]) if r["action_items"] else [],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# RAG — Semantic search over all indexed data & documents
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def rag_search(query: str, source_filter: Optional[str] = None, top_k: int = 5) -> str:
    """Semantic search across all indexed documents and app data using RAG.
    source_filter can be: 'document', 'slack_message', 'github_issue', 'github_pr', 'meeting'.
    Returns the most relevant chunks with their source and score."""
    try:
        from services.rag_service import search_documents

        results = await search_documents(query, top_k=top_k, source_filter=source_filter)
        if not results:
            return "No relevant documents found."
        return json.dumps(results, indent=2, default=str)
    except Exception as e:
        return f"RAG search failed: {e}"


@tool
async def db_query_data(source_type: str, query: str, limit: int = 10) -> str:
    """Search the indexed data store (data_index table) by source type and keyword.
    source_type: 'slack_message', 'github_issue', 'github_pr', 'meeting'.
    query: Text search keyword.
    This is useful for finding specific indexed data when RAG semantic search
    is too broad."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT title, content, source_type, entity_id, metadata
           FROM data_index
           WHERE source_type = $1 AND (title ILIKE $2 OR content ILIKE $2)
           ORDER BY indexed_at DESC LIMIT $3""",
        source_type, f"%{query}%", limit,
    )
    if not rows:
        return f"No indexed data found for source_type='{source_type}' matching '{query}'."
    results = [
        {
            "title": r["title"],
            "content": r["content"][:500],
            "source_type": r["source_type"],
            "entity_id": r["entity_id"],
        }
        for r in rows
    ]
    return json.dumps(results, indent=2)


# ═══════════════════════════════════════════════════════════════════════════════
# All agent tools list — exported for graph.py
# ═══════════════════════════════════════════════════════════════════════════════

AGENT_TOOLS = [
    # Slack — Read
    slack_list_channels,
    slack_list_users,
    slack_get_channel_messages,
    slack_get_thread,
    slack_search_messages,
    slack_get_channel_info,
    slack_get_pins,
    slack_get_user_presence,
    slack_list_files,
    # Slack — Write
    slack_send_message,
    slack_send_dm,
    slack_add_reaction,
    slack_pin_message,
    slack_schedule_message,
    slack_edit_message,
    slack_delete_message,
    # GitHub — Read
    github_list_repos,
    github_list_issues,
    github_get_issue_detail,
    github_list_pull_requests,
    github_get_pr_detail,
    github_list_commits,
    github_list_branches,
    github_get_actions,
    github_read_file,
    github_search_code,
    github_get_notifications,
    github_get_readme,
    github_list_labels,
    # GitHub — Write
    github_create_issue,
    github_create_branch,
    github_submit_pr_review,
    github_merge_pr,
    github_create_release,
    # Meetings
    meetings_list,
    meetings_get_summary,
    meetings_get_actions,
    meeting_search,
    # RAG & Data
    rag_search,
    db_query_data,
]
