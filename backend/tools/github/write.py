"""
GitHub write tools — create issues, branches, submit reviews, merge PRs.
"""

from __future__ import annotations

from services.github_client import _gh
from tools import tool
from tools.github.models import (
    CreateBranchInput,
    CreateGistInput,
    CreateIssueInput,
    CreateMilestoneInput,
    CreateReleaseInput,
    CreatedBranch,
    CreatedGist,
    CreatedIssue,
    CreatedMilestone,
    CreatedRelease,
    MergeResult,
    PRMergeInput,
    PRReviewInput,
    ReviewResult,
)
from tools.github.sync import _gh_exc


# ── create issue ──────────────────────────────────────────────────────────

@tool(
    name="github_create_issue",
    description="Create a new issue in a GitHub repo",
    integration="github",
    method="POST",
    path="/issues",
    idempotent=False,
)
async def github_create_issue(inp: CreateIssueInput) -> CreatedIssue:
    try:
        payload: dict = {"title": inp.title, "body": inp.body}
        if inp.labels:
            payload["labels"] = [lb.strip() for lb in inp.labels.split(",") if lb.strip()]
        if inp.assignee:
            payload["assignees"] = [inp.assignee]
        data = await _gh("POST", f"/repos/{inp.repo}/issues", json=payload)
        return CreatedIssue(number=data["number"], url=data["html_url"], title=data["title"])
    except Exception as e:
        raise _gh_exc(e)


# ── create branch ─────────────────────────────────────────────────────────

@tool(
    name="github_create_branch",
    description="Create a new branch in a GitHub repo",
    integration="github",
    method="POST",
    path="/branches",
    idempotent=False,
)
async def github_create_branch(inp: CreateBranchInput) -> CreatedBranch:
    try:
        repo_data = await _gh("GET", f"/repos/{inp.repo}")
        base = inp.from_branch or repo_data["default_branch"]
        ref_data = await _gh("GET", f"/repos/{inp.repo}/git/ref/heads/{base}")
        sha = ref_data["object"]["sha"]
        await _gh("POST", f"/repos/{inp.repo}/git/refs", json={"ref": f"refs/heads/{inp.branch}", "sha": sha})
        return CreatedBranch(branch=inp.branch, from_branch=base, sha=sha[:8])
    except Exception as e:
        raise _gh_exc(e)


# ── submit PR review ──────────────────────────────────────────────────────

@tool(
    name="github_submit_pr_review",
    description="Submit a review on a GitHub pull request",
    integration="github",
    method="POST",
    path="/prs/review",
    idempotent=False,
)
async def github_submit_pr_review(inp: PRReviewInput) -> ReviewResult:
    try:
        data = await _gh(
            "POST",
            f"/repos/{inp.repo}/pulls/{inp.number}/reviews",
            json={"event": inp.event.upper(), "body": inp.body},
        )
        return ReviewResult(id=data["id"], state=data["state"], submitted_at=data.get("submitted_at"))
    except Exception as e:
        raise _gh_exc(e)


# ── merge PR ──────────────────────────────────────────────────────────────

@tool(
    name="github_merge_pr",
    description="Merge a GitHub pull request",
    integration="github",
    method="POST",
    path="/prs/merge",
    idempotent=False,
)
async def github_merge_pr(inp: PRMergeInput) -> MergeResult:
    try:
        payload: dict = {"merge_method": inp.merge_method}
        if inp.commit_title:
            payload["commit_title"] = inp.commit_title
        if inp.commit_message:
            payload["commit_message"] = inp.commit_message
        data = await _gh("PUT", f"/repos/{inp.repo}/pulls/{inp.number}/merge", json=payload)
        return MergeResult(
            merged=data.get("merged", False),
            sha=data.get("sha", "")[:8],
            message=data.get("message", ""),
        )
    except Exception as e:
        raise _gh_exc(e)


# ── create release ────────────────────────────────────────────────────────

@tool(
    name="github_create_release",
    description="Create a new release in a GitHub repo",
    integration="github",
    method="POST",
    path="/releases",
    idempotent=False,
)
async def github_create_release(inp: CreateReleaseInput) -> CreatedRelease:
    try:
        payload: dict = {
            "tag_name": inp.tag_name,
            "name": inp.name or inp.tag_name,
            "body": inp.body or "",
            "draft": inp.draft,
            "prerelease": inp.prerelease,
        }
        if inp.target_commitish:
            payload["target_commitish"] = inp.target_commitish
        data = await _gh("POST", f"/repos/{inp.repo}/releases", json=payload)
        return CreatedRelease(
            id=data["id"], tag_name=data["tag_name"], html_url=data["html_url"],
        )
    except Exception as e:
        raise _gh_exc(e)


# ── create milestone ──────────────────────────────────────────────────────

@tool(
    name="github_create_milestone",
    description="Create a new milestone in a GitHub repo",
    integration="github",
    method="POST",
    path="/milestones",
    idempotent=False,
)
async def github_create_milestone(inp: CreateMilestoneInput) -> CreatedMilestone:
    try:
        payload: dict = {"title": inp.title}
        if inp.description:
            payload["description"] = inp.description
        if inp.due_on:
            payload["due_on"] = inp.due_on
        data = await _gh("POST", f"/repos/{inp.repo}/milestones", json=payload)
        return CreatedMilestone(
            number=data["number"], title=data["title"], html_url=data["html_url"],
        )
    except Exception as e:
        raise _gh_exc(e)


# ── create gist ───────────────────────────────────────────────────────────

@tool(
    name="github_create_gist",
    description="Create a new GitHub gist",
    integration="github",
    method="POST",
    path="/gists",
    idempotent=False,
)
async def github_create_gist(inp: CreateGistInput) -> CreatedGist:
    try:
        data = await _gh("POST", "/gists", json={
            "description": inp.description or "",
            "public": inp.public,
            "files": {inp.filename: {"content": inp.content}},
        })
        return CreatedGist(id=data["id"], html_url=data["html_url"])
    except Exception as e:
        raise _gh_exc(e)
