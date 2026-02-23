"""Pydantic models for GitHub tools (Input / Output)."""

from __future__ import annotations

from pydantic import BaseModel


# ── Output models ──────────────────────────────────────────────────────────

class GitHubRepo(BaseModel):
    id: int
    full_name: str
    name: str
    description: str | None = None
    language: str | None = None
    stars: int = 0
    forks: int = 0
    open_issues: int = 0
    is_private: bool = False
    html_url: str = ""
    default_branch: str = "main"
    updated_at: str | None = None


class RepoOverview(BaseModel):
    full_name: str
    description: str | None = None
    language: str | None = None
    open_issues_count: int = 0
    open_prs_count: int = 0
    stars: int = 0
    forks: int = 0
    default_branch: str = "main"
    last_commit_sha: str | None = None
    last_commit_message: str | None = None
    last_commit_author: str | None = None
    last_commit_date: str | None = None


class GitHubIssue(BaseModel):
    number: int
    title: str
    state: str = "open"
    assignee: str | None = None
    labels: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    url: str = ""
    body: str = ""


class IssueDetail(BaseModel):
    number: int
    title: str
    state: str = "open"
    body: str = ""
    assignee: str | None = None
    labels: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None
    url: str = ""
    comments: list[dict] = []


class CreatedIssue(BaseModel):
    number: int
    url: str = ""
    title: str = ""


class GitHubPR(BaseModel):
    number: int
    title: str
    state: str = "open"
    author: str = ""
    base: str = ""
    head: str = ""
    draft: bool = False
    created_at: str | None = None
    updated_at: str | None = None
    url: str = ""
    requested_reviewers: list[str] = []


class PRDetail(BaseModel):
    number: int
    title: str
    state: str = "open"
    body: str = ""
    author: str = ""
    base: str = ""
    head: str = ""
    draft: bool = False
    mergeable: bool | None = None
    url: str = ""
    created_at: str | None = None
    updated_at: str | None = None
    requested_reviewers: list[str] = []
    reviews: list[dict] = []
    changed_files: list[dict] = []


class ReviewResult(BaseModel):
    id: int
    state: str = ""
    submitted_at: str | None = None


class MergeResult(BaseModel):
    merged: bool = False
    sha: str = ""
    message: str = ""


class GitHubCommit(BaseModel):
    sha: str
    message: str = ""
    author: str = ""
    date: str | None = None
    url: str = ""


class WorkflowRun(BaseModel):
    id: int
    name: str = ""
    status: str = ""
    conclusion: str | None = None
    branch: str = ""
    created_at: str | None = None
    url: str = ""


class GitHubBranch(BaseModel):
    name: str
    sha: str = ""
    protected: bool = False


class CreatedBranch(BaseModel):
    branch: str
    from_branch: str = ""
    sha: str = ""


class GitHubLabel(BaseModel):
    name: str
    color: str = ""
    description: str = ""


class GitHubNotification(BaseModel):
    id: str
    type: str = ""
    title: str = ""
    repo: str = ""
    updated_at: str | None = None


# ── Input models ───────────────────────────────────────────────────────────

class RepoOverviewInput(BaseModel):
    owner: str
    repo: str


class ListIssuesInput(BaseModel):
    repo: str  # owner/repo
    state: str = "open"
    assignee: str = ""
    label: str = ""
    days: int = 0  # 0 = no time limit


class IssueDetailInput(BaseModel):
    owner: str
    repo: str
    number: int


class CreateIssueInput(BaseModel):
    repo: str
    title: str
    body: str = ""
    labels: str = ""
    assignee: str = ""


class ListPRsInput(BaseModel):
    repo: str
    state: str = "open"
    days: int = 0  # 0 = no time limit


class PRDetailInput(BaseModel):
    owner: str
    repo: str
    number: int


class PRReviewInput(BaseModel):
    repo: str
    number: int
    event: str = "COMMENT"
    body: str = ""


class PRMergeInput(BaseModel):
    repo: str
    number: int
    merge_method: str = "merge"
    commit_title: str = ""
    commit_message: str = ""


class ListCommitsInput(BaseModel):
    repo: str
    days: int = 0  # 0 = no time limit
    author: str = ""


class RepoQueryInput(BaseModel):
    """Input for tools that just need a repo name (owner/repo)."""
    repo: str


class CreateBranchInput(BaseModel):
    repo: str
    branch: str
    from_branch: str = ""


# ── New Output models (v4.1) ──────────────────────────────────────────────

class CodeSearchResult(BaseModel):
    path: str
    repo: str = ""
    sha: str = ""
    score: float = 0.0
    html_url: str = ""
    text_matches: list[str] = []


class FileContent(BaseModel):
    path: str
    name: str = ""
    sha: str = ""
    size: int = 0
    encoding: str = ""
    content: str = ""
    html_url: str = ""
    download_url: str = ""


class GitHubRelease(BaseModel):
    id: int
    tag_name: str
    name: str = ""
    body: str = ""
    draft: bool = False
    prerelease: bool = False
    created_at: str | None = None
    published_at: str | None = None
    html_url: str = ""
    author: str = ""


class CreatedRelease(BaseModel):
    id: int
    tag_name: str = ""
    html_url: str = ""


class GitHubContributor(BaseModel):
    login: str
    avatar_url: str = ""
    contributions: int = 0
    html_url: str = ""


class CommitComparison(BaseModel):
    status: str = ""
    ahead_by: int = 0
    behind_by: int = 0
    total_commits: int = 0
    files: list[dict] = []
    commits: list[dict] = []


class GitHubMilestone(BaseModel):
    number: int
    title: str
    state: str = "open"
    description: str = ""
    open_issues: int = 0
    closed_issues: int = 0
    due_on: str | None = None
    html_url: str = ""


class CreatedMilestone(BaseModel):
    number: int
    title: str = ""
    html_url: str = ""


class GitHubDeployment(BaseModel):
    id: int
    environment: str = ""
    ref: str = ""
    task: str = ""
    created_at: str | None = None
    updated_at: str | None = None
    creator: str = ""
    description: str = ""


class ReadmeContent(BaseModel):
    name: str = ""
    path: str = ""
    content: str = ""
    html_url: str = ""


class GitHubGist(BaseModel):
    id: str
    description: str = ""
    html_url: str = ""
    public: bool = True
    files: list[str] = []
    created_at: str | None = None
    updated_at: str | None = None


class CreatedGist(BaseModel):
    id: str
    html_url: str = ""


class RateLimit(BaseModel):
    limit: int = 0
    remaining: int = 0
    reset: int = 0
    used: int = 0


# ── New Input models (v4.1) ──────────────────────────────────────────────

class SearchCodeInput(BaseModel):
    q: str
    repo: str = ""  # optional: scope to a specific repo


class GetFileContentInput(BaseModel):
    repo: str
    path: str
    ref: str = ""  # branch/tag/sha


class ListReleasesInput(BaseModel):
    repo: str


class CreateReleaseInput(BaseModel):
    repo: str
    tag_name: str
    name: str = ""
    body: str = ""
    draft: bool = False
    prerelease: bool = False
    target_commitish: str = ""


class CompareInput(BaseModel):
    repo: str
    base: str
    head: str


class ListMilestonesInput(BaseModel):
    repo: str
    state: str = "open"


class CreateMilestoneInput(BaseModel):
    repo: str
    title: str
    description: str = ""
    due_on: str = ""  # ISO 8601 date


class CreateGistInput(BaseModel):
    description: str = ""
    public: bool = True
    filename: str = "file.txt"
    content: str = ""
