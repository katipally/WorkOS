"""
GitHub read tools — repos, issues, PRs, commits, branches, labels, etc.

Sync-backed tools (repos) read from the local DB first, falling back to
a live sync when the table is empty.  Everything else is always live.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from db.connection import get_db_pool
from services.github_client import _gh
from tools import tool
from tools.base import EmptyInput
from tools.github.models import (
    CodeSearchResult,
    CommitComparison,
    CompareInput,
    FileContent,
    GetFileContentInput,
    GitHubBranch,
    GitHubCommit,
    GitHubContributor,
    GitHubDeployment,
    GitHubGist,
    GitHubIssue,
    GitHubLabel,
    GitHubMilestone,
    GitHubNotification,
    GitHubPR,
    GitHubRepo,
    IssueDetail,
    IssueDetailInput,
    ListCommitsInput,
    ListIssuesInput,
    ListMilestonesInput,
    ListPRsInput,
    ListReleasesInput,
    GitHubRelease,
    PRDetail,
    PRDetailInput,
    RateLimit,
    ReadmeContent,
    RepoOverview,
    RepoOverviewInput,
    RepoQueryInput,
    SearchCodeInput,
    WorkflowRun,
)
from tools.github.sync import _gh_exc, github_sync_repos


# ── repos (DB-backed) ─────────────────────────────────────────────────────

@tool(
    name="github_list_repos",
    description="List GitHub repos (from local DB, auto-syncs if empty)",
    integration="github",
    method="GET",
    path="/repos",
)
async def github_list_repos(inp: EmptyInput) -> list[GitHubRepo]:
    pool = await get_db_pool()
    rows = await pool.fetch("SELECT * FROM github_repos ORDER BY full_name")
    if not rows:
        return await github_sync_repos(inp)
    return [
        GitHubRepo(
            id=r["id"], full_name=r["full_name"], name=r["name"],
            description=r["description"], language=r["language"],
            stars=r["stars"], forks=r["forks"],
            open_issues=r["open_issues"], is_private=r["is_private"],
            html_url=r["html_url"], default_branch=r["default_branch"],
            updated_at=r["updated_at"].isoformat() if r["updated_at"] else None,
        )
        for r in rows
    ]


# ── repo overview (live) ─────────────────────────────────────────────────

@tool(
    name="github_get_repo_overview",
    description="Get dashboard overview for a GitHub repo",
    integration="github",
    method="GET",
    path="/repos/{owner}/{repo_name}/overview",
)
async def github_get_repo_overview(inp: RepoOverviewInput) -> RepoOverview:
    full_name = f"{inp.owner}/{inp.repo}"
    try:
        _results = await asyncio.gather(
            _gh("GET", f"/repos/{full_name}"),
            _gh("GET", f"/repos/{full_name}/issues", params={"state": "open", "per_page": 5}),
            _gh("GET", f"/repos/{full_name}/pulls", params={"state": "open", "per_page": 5}),
            _gh("GET", f"/repos/{full_name}/commits", params={"per_page": 1}),
        )
    except Exception as e:
        raise _gh_exc(e)

    repo_data: dict = _results[0]
    prs_data: list = _results[2]
    commits_data: list = _results[3]

    return RepoOverview(
        full_name=repo_data["full_name"],
        description=repo_data.get("description"),
        language=repo_data.get("language"),
        open_issues_count=repo_data["open_issues_count"],
        open_prs_count=len(prs_data),
        stars=repo_data["stargazers_count"],
        forks=repo_data["forks_count"],
        default_branch=repo_data["default_branch"],
        last_commit_sha=commits_data[0]["sha"][:8] if commits_data else None,
        last_commit_message=commits_data[0]["commit"]["message"].split("\n")[0] if commits_data else None,
        last_commit_author=commits_data[0]["commit"]["author"]["name"] if commits_data else None,
        last_commit_date=commits_data[0]["commit"]["author"]["date"] if commits_data else None,
    )


# ── issues (live) ─────────────────────────────────────────────────────────

@tool(
    name="github_list_issues",
    description="List issues for a GitHub repo",
    integration="github",
    method="GET",
    path="/issues",
)
async def github_list_issues(inp: ListIssuesInput) -> list[GitHubIssue]:
    try:
        params: dict = {"state": inp.state, "per_page": 50}
        if inp.assignee:
            params["assignee"] = inp.assignee
        if inp.label:
            params["labels"] = inp.label
        if inp.days > 0:
            since = (datetime.now(timezone.utc) - timedelta(days=inp.days)).isoformat()
            params["since"] = since
        data = await _gh("GET", f"/repos/{inp.repo}/issues", params=params)
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubIssue(
            number=i["number"], title=i["title"], state=i["state"],
            assignee=i["assignee"]["login"] if i.get("assignee") else None,
            labels=[lb["name"] for lb in i.get("labels", [])],
            created_at=i["created_at"], updated_at=i["updated_at"],
            url=i["html_url"], body=(i.get("body") or "")[:500],
        )
        for i in data
        if "pull_request" not in i
    ]


@tool(
    name="github_get_issue_detail",
    description="Get full details for a GitHub issue including comments",
    integration="github",
    method="GET",
    path="/issues/{owner}/{repo_name}/{number}",
)
async def github_get_issue_detail(inp: IssueDetailInput) -> IssueDetail:
    try:
        full_name = f"{inp.owner}/{inp.repo}"
        _results = await asyncio.gather(
            _gh("GET", f"/repos/{full_name}/issues/{inp.number}"),
            _gh("GET", f"/repos/{full_name}/issues/{inp.number}/comments"),
        )
    except Exception as e:
        raise _gh_exc(e)

    issue: dict = _results[0]
    comments: list = _results[1]

    return IssueDetail(
        number=issue["number"], title=issue["title"], state=issue["state"],
        body=issue.get("body", ""),
        assignee=issue["assignee"]["login"] if issue.get("assignee") else None,
        labels=[lb["name"] for lb in issue.get("labels", [])],
        created_at=issue["created_at"], updated_at=issue["updated_at"],
        url=issue["html_url"],
        comments=[
            {"author": c["user"]["login"], "body": c["body"], "created_at": c["created_at"]}
            for c in comments[-10:]
        ],
    )


# ── pull requests (live) ─────────────────────────────────────────────────

@tool(
    name="github_list_prs",
    description="List pull requests for a GitHub repo",
    integration="github",
    method="GET",
    path="/prs",
)
async def github_list_prs(inp: ListPRsInput) -> list[GitHubPR]:
    try:
        data = await _gh(
            "GET", f"/repos/{inp.repo}/pulls",
            params={"state": inp.state, "per_page": 30, "sort": "updated"},
        )
    except Exception as e:
        raise _gh_exc(e)

    results = []
    cutoff = None
    if inp.days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=inp.days)
    for pr in data:
        if cutoff and pr.get("updated_at"):
            pr_date = datetime.fromisoformat(pr["updated_at"].replace("Z", "+00:00"))
            if pr_date < cutoff:
                continue
        results.append(
            GitHubPR(
                number=pr["number"], title=pr["title"], state=pr["state"],
                author=pr["user"]["login"], base=pr["base"]["ref"], head=pr["head"]["ref"],
                draft=pr.get("draft", False), created_at=pr["created_at"],
                updated_at=pr["updated_at"], url=pr["html_url"],
                requested_reviewers=[r["login"] for r in pr.get("requested_reviewers", [])],
            )
        )
    return results


@tool(
    name="github_get_pr_detail",
    description="Get full detail for a pull request including reviews and changed files",
    integration="github",
    method="GET",
    path="/prs/{owner}/{repo_name}/{number}",
)
async def github_get_pr_detail(inp: PRDetailInput) -> PRDetail:
    try:
        full_name = f"{inp.owner}/{inp.repo}"
        _results = await asyncio.gather(
            _gh("GET", f"/repos/{full_name}/pulls/{inp.number}"),
            _gh("GET", f"/repos/{full_name}/pulls/{inp.number}/reviews"),
            _gh("GET", f"/repos/{full_name}/pulls/{inp.number}/files", params={"per_page": 30}),
        )
    except Exception as e:
        raise _gh_exc(e)

    pr: dict = _results[0]
    reviews: list = _results[1]
    files: list = _results[2]

    return PRDetail(
        number=pr["number"], title=pr["title"], state=pr["state"],
        body=pr.get("body", ""), author=pr["user"]["login"],
        base=pr["base"]["ref"], head=pr["head"]["ref"],
        draft=pr.get("draft", False), mergeable=pr.get("mergeable"),
        url=pr["html_url"], created_at=pr["created_at"], updated_at=pr["updated_at"],
        requested_reviewers=[r["login"] for r in pr.get("requested_reviewers", [])],
        reviews=[
            {"reviewer": r["user"]["login"], "state": r["state"], "body": r.get("body", "")}
            for r in reviews
        ],
        changed_files=[
            {"filename": f["filename"], "status": f["status"],
             "additions": f["additions"], "deletions": f["deletions"]}
            for f in files
        ],
    )


# ── commits (live) ────────────────────────────────────────────────────────

@tool(
    name="github_list_commits",
    description="List recent commits for a GitHub repo",
    integration="github",
    method="GET",
    path="/commits",
)
async def github_list_commits(inp: ListCommitsInput) -> list[GitHubCommit]:
    try:
        params: dict = {"per_page": 50}
        if inp.days > 0:
            since = (datetime.now(timezone.utc) - timedelta(days=inp.days)).isoformat()
            params["since"] = since
        if inp.author:
            params["author"] = inp.author
        data = await _gh("GET", f"/repos/{inp.repo}/commits", params=params)
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubCommit(
            sha=c["sha"][:8],
            message=c["commit"]["message"].split("\n")[0],
            author=c["commit"]["author"]["name"],
            date=c["commit"]["author"]["date"],
            url=c["html_url"],
        )
        for c in data
    ]


# ── workflow runs (live) ──────────────────────────────────────────────────

@tool(
    name="github_get_actions",
    description="Get recent GitHub Actions workflow runs",
    integration="github",
    method="GET",
    path="/actions",
)
async def github_get_actions(inp: RepoQueryInput) -> list[WorkflowRun]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/actions/runs", params={"per_page": 15})
    except Exception as e:
        raise _gh_exc(e)

    runs = data.get("workflow_runs", []) if isinstance(data, dict) else []
    return [
        WorkflowRun(
            id=r["id"], name=r["name"], status=r["status"],
            conclusion=r.get("conclusion"), branch=r["head_branch"],
            created_at=r["created_at"], url=r["html_url"],
        )
        for r in runs
    ]


# ── branches (live) ───────────────────────────────────────────────────────

@tool(
    name="github_list_branches",
    description="List branches for a GitHub repo",
    integration="github",
    method="GET",
    path="/branches",
)
async def github_list_branches(inp: RepoQueryInput) -> list[GitHubBranch]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/branches", params={"per_page": 50})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubBranch(name=b["name"], sha=b["commit"]["sha"][:8], protected=b.get("protected", False))
        for b in data
    ]


# ── labels (live) ─────────────────────────────────────────────────────────

@tool(
    name="github_list_labels",
    description="List labels for a GitHub repo",
    integration="github",
    method="GET",
    path="/labels",
)
async def github_list_labels(inp: RepoQueryInput) -> list[GitHubLabel]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/labels", params={"per_page": 50})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubLabel(name=lb["name"], color=lb["color"], description=lb.get("description", ""))
        for lb in data
    ]


# ── notifications (live) ─────────────────────────────────────────────────

@tool(
    name="github_get_notifications",
    description="Get unread GitHub notifications",
    integration="github",
    method="GET",
    path="/notifications",
)
async def github_get_notifications(inp: EmptyInput) -> list[GitHubNotification]:
    try:
        data = await _gh("GET", "/notifications", params={"all": "false", "per_page": 30})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubNotification(
            id=n["id"], type=n["subject"]["type"], title=n["subject"]["title"],
            repo=n["repository"]["full_name"], updated_at=n["updated_at"],
        )
        for n in data
    ]


# ── search code (live) ───────────────────────────────────────────────────

@tool(
    name="github_search_code",
    description="Search code across GitHub repositories",
    integration="github",
    method="GET",
    path="/search/code",
)
async def github_search_code(inp: SearchCodeInput) -> list[CodeSearchResult]:
    try:
        query = f"{inp.q} repo:{inp.repo}" if inp.repo else inp.q
        data = await _gh(
            "GET", "/search/code",
            params={"q": query, "per_page": 20},
        )
    except Exception as e:
        raise _gh_exc(e)

    items = data.get("items", []) if isinstance(data, dict) else []
    return [
        CodeSearchResult(
            path=item["path"],
            repo=item["repository"]["full_name"],
            sha=item.get("sha", "")[:8],
            score=item.get("score", 0),
            html_url=item.get("html_url", ""),
            text_matches=[
                m.get("fragment", "")
                for m in item.get("text_matches", [])
            ],
        )
        for item in items
    ]


# ── file content (live) ──────────────────────────────────────────────────

@tool(
    name="github_get_file_content",
    description="Get the content of a file from a GitHub repo",
    integration="github",
    method="GET",
    path="/files",
)
async def github_get_file_content(inp: GetFileContentInput) -> FileContent:
    try:
        params: dict = {}
        if inp.ref:
            params["ref"] = inp.ref
        data = await _gh("GET", f"/repos/{inp.repo}/contents/{inp.path}", params=params)
    except Exception as e:
        raise _gh_exc(e)

    content = ""
    if data.get("encoding") == "base64" and data.get("content"):
        import base64
        try:
            content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            content = "(binary file)"

    return FileContent(
        path=data.get("path", inp.path),
        name=data.get("name", ""),
        sha=data.get("sha", "")[:8],
        size=data.get("size", 0),
        encoding=data.get("encoding", ""),
        content=content[:50000],  # cap at 50KB
        html_url=data.get("html_url", ""),
        download_url=data.get("download_url", ""),
    )


# ── directory listing (live) ─────────────────────────────────────────────

class _ListContentsInput(EmptyInput):
    repo: str
    path: str = ""
    ref: str = ""


class _DirEntry(EmptyInput):
    name: str = ""
    path: str = ""
    type: str = ""      # "file" or "dir"
    size: int = 0
    sha: str = ""
    html_url: str = ""


@tool(
    name="github_list_contents",
    description="List files and directories at a given path in a GitHub repo",
    integration="github",
    method="GET",
    path="/contents",
)
async def github_list_contents(inp: _ListContentsInput) -> list[_DirEntry]:
    """Return directory entries for a path, or a single-item list for a file."""
    try:
        params: dict = {}
        if inp.ref:
            params["ref"] = inp.ref
        path = inp.path.strip("/") if inp.path else ""
        endpoint = f"/repos/{inp.repo}/contents/{path}" if path else f"/repos/{inp.repo}/contents"
        data = await _gh("GET", endpoint, params=params)
    except Exception as e:
        raise _gh_exc(e)

    # GitHub returns a list for directories, a dict for files
    if isinstance(data, dict):
        return [_DirEntry(
            name=data.get("name", ""),
            path=data.get("path", ""),
            type=data.get("type", "file"),
            size=data.get("size", 0),
            sha=(data.get("sha") or "")[:8],
            html_url=data.get("html_url", ""),
        )]

    entries = []
    for item in sorted(data, key=lambda x: (0 if x.get("type") == "dir" else 1, x.get("name", "").lower())):
        entries.append(_DirEntry(
            name=item.get("name", ""),
            path=item.get("path", ""),
            type=item.get("type", "file"),
            size=item.get("size", 0),
            sha=(item.get("sha") or "")[:8],
            html_url=item.get("html_url", ""),
        ))
    return entries


# ── releases (live) ──────────────────────────────────────────────────────

@tool(
    name="github_list_releases",
    description="List releases for a GitHub repo",
    integration="github",
    method="GET",
    path="/releases",
)
async def github_list_releases(inp: ListReleasesInput) -> list[GitHubRelease]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/releases", params={"per_page": 20})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubRelease(
            id=r["id"], tag_name=r["tag_name"], name=r.get("name", ""),
            body=(r.get("body") or "")[:2000], draft=r.get("draft", False),
            prerelease=r.get("prerelease", False),
            created_at=r.get("created_at"), published_at=r.get("published_at"),
            html_url=r.get("html_url", ""),
            author=r.get("author", {}).get("login", ""),
        )
        for r in data
    ]


# ── contributors (live) ──────────────────────────────────────────────────

@tool(
    name="github_list_contributors",
    description="List contributors for a GitHub repo",
    integration="github",
    method="GET",
    path="/contributors",
)
async def github_list_contributors(inp: RepoQueryInput) -> list[GitHubContributor]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/contributors", params={"per_page": 30})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubContributor(
            login=c["login"], avatar_url=c.get("avatar_url", ""),
            contributions=c.get("contributions", 0),
            html_url=c.get("html_url", ""),
        )
        for c in data
    ]


# ── compare commits (live) ───────────────────────────────────────────────

@tool(
    name="github_compare_commits",
    description="Compare two branches, tags, or commits",
    integration="github",
    method="GET",
    path="/compare",
)
async def github_compare_commits(inp: CompareInput) -> CommitComparison:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/compare/{inp.base}...{inp.head}")
    except Exception as e:
        raise _gh_exc(e)

    return CommitComparison(
        status=data.get("status", ""),
        ahead_by=data.get("ahead_by", 0),
        behind_by=data.get("behind_by", 0),
        total_commits=data.get("total_commits", 0),
        files=[
            {
                "filename": f["filename"], "status": f["status"],
                "additions": f["additions"], "deletions": f["deletions"],
            }
            for f in data.get("files", [])[:50]
        ],
        commits=[
            {
                "sha": c["sha"][:8],
                "message": c["commit"]["message"].split("\n")[0],
                "author": c["commit"]["author"]["name"],
            }
            for c in data.get("commits", [])[:30]
        ],
    )


# ── milestones (live) ────────────────────────────────────────────────────

@tool(
    name="github_list_milestones",
    description="List milestones for a GitHub repo",
    integration="github",
    method="GET",
    path="/milestones",
)
async def github_list_milestones(inp: ListMilestonesInput) -> list[GitHubMilestone]:
    try:
        data = await _gh(
            "GET", f"/repos/{inp.repo}/milestones",
            params={"state": inp.state, "per_page": 30},
        )
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubMilestone(
            number=m["number"], title=m["title"],
            state=m.get("state", "open"),
            description=m.get("description") or "",
            open_issues=m.get("open_issues", 0),
            closed_issues=m.get("closed_issues", 0),
            due_on=m.get("due_on"),
            html_url=m.get("html_url", ""),
        )
        for m in data
    ]


# ── deployments (live) ───────────────────────────────────────────────────

@tool(
    name="github_list_deployments",
    description="List deployments for a GitHub repo",
    integration="github",
    method="GET",
    path="/deployments",
)
async def github_list_deployments(inp: RepoQueryInput) -> list[GitHubDeployment]:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/deployments", params={"per_page": 20})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubDeployment(
            id=d["id"], environment=d.get("environment", ""),
            ref=d.get("ref", ""), task=d.get("task", ""),
            created_at=d.get("created_at"), updated_at=d.get("updated_at"),
            creator=d.get("creator", {}).get("login", ""),
            description=d.get("description") or "",
        )
        for d in data
    ]


# ── README (live) ────────────────────────────────────────────────────────

@tool(
    name="github_get_readme",
    description="Get the README content of a GitHub repo",
    integration="github",
    method="GET",
    path="/readme",
)
async def github_get_readme(inp: RepoQueryInput) -> ReadmeContent:
    try:
        data = await _gh("GET", f"/repos/{inp.repo}/readme")
    except Exception as e:
        raise _gh_exc(e)

    content = ""
    if data.get("encoding") == "base64" and data.get("content"):
        import base64
        try:
            content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            content = ""

    return ReadmeContent(
        name=data.get("name", ""),
        path=data.get("path", ""),
        content=content[:100000],
        html_url=data.get("html_url", ""),
    )


# ── gists (live) ─────────────────────────────────────────────────────────

@tool(
    name="github_list_gists",
    description="List the authenticated user's gists",
    integration="github",
    method="GET",
    path="/gists",
)
async def github_list_gists(inp: EmptyInput) -> list[GitHubGist]:
    try:
        data = await _gh("GET", "/gists", params={"per_page": 20})
    except Exception as e:
        raise _gh_exc(e)

    return [
        GitHubGist(
            id=g["id"],
            description=g.get("description") or "",
            html_url=g.get("html_url", ""),
            public=g.get("public", True),
            files=list((g.get("files") or {}).keys()),
            created_at=g.get("created_at"),
            updated_at=g.get("updated_at"),
        )
        for g in data
    ]


# ── rate limit (live) ────────────────────────────────────────────────────

@tool(
    name="github_get_rate_limit",
    description="Get GitHub API rate limit status",
    integration="github",
    method="GET",
    path="/rate-limit",
)
async def github_get_rate_limit(inp: EmptyInput) -> RateLimit:
    try:
        data = await _gh("GET", "/rate_limit")
    except Exception as e:
        raise _gh_exc(e)

    core = data.get("resources", {}).get("core", {})
    return RateLimit(
        limit=core.get("limit", 0),
        remaining=core.get("remaining", 0),
        reset=core.get("reset", 0),
        used=core.get("used", 0),
    )
