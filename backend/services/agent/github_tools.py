"""
GitHub agent tools — LangChain @tool definitions for GitHub read/write operations.
"""

from __future__ import annotations

import json
import logging
from typing import Optional

from langchain_core.tools import tool

from db.connection import get_pool

log = logging.getLogger(__name__)


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


# ─── Export lists ─────────────────────────────────────────────────────────────

GITHUB_READ_TOOLS = [
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
]

GITHUB_WRITE_TOOLS = [
    github_create_issue,
    github_create_branch,
    github_submit_pr_review,
    github_merge_pr,
    github_create_release,
]

GITHUB_TOOLS = GITHUB_READ_TOOLS + GITHUB_WRITE_TOOLS
