"""Pydantic models for Jira tools (Input / Output)."""

from __future__ import annotations

from pydantic import BaseModel


# ── Output models ──────────────────────────────────────────────────────────

class JiraProject(BaseModel):
    key: str
    name: str
    id: str
    type: str = ""
    avatar: str = ""


class ProjectStats(BaseModel):
    project: str
    open_count: int = 0
    by_status: dict = {}


class JiraIssue(BaseModel):
    key: str | None = None
    id: str | None = None
    summary: str = ""
    status: str = ""
    priority: str = ""
    issue_type: str = ""
    assignee: str = ""
    labels: list[str] = []
    created: str = ""
    updated: str = ""
    url: str = ""


class JiraIssueDetail(JiraIssue):
    body: str = ""
    comments: list[dict] = []


class CreatedIssue(BaseModel):
    key: str | None = None
    id: str | None = None


class UpdatedIssue(BaseModel):
    key: str
    updated: list[str] = []


class TransitionResult(BaseModel):
    key: str = ""
    transitioned_to: str = ""
    error: str = ""
    available: list[str] = []


class CommentResult(BaseModel):
    id: str | None = None
    issue_key: str = ""


class SprintBoard(BaseModel):
    total: int = 0
    by_status: dict = {}
    issues: list[JiraIssue] = []


class Watchers(BaseModel):
    issue_key: str
    watch_count: int = 0
    watchers: list[dict] = []


class WatcherAdded(BaseModel):
    issue_key: str
    added: str = ""


class BulkTransitionResult(BaseModel):
    results: list[dict] = []


class SprintVelocity(BaseModel):
    project: str
    closed_sprint_issues: int = 0
    done_issues: int = 0
    total_story_points: float = 0.0


class JiraAssignableUser(BaseModel):
    account_id: str | None = None
    display_name: str = ""
    email: str = ""


# ── Input models ───────────────────────────────────────────────────────────

class ProjectKeyInput(BaseModel):
    key: str


class ProjectQueryInput(BaseModel):
    project: str


class SearchIssuesInput(BaseModel):
    jql: str
    max_results: int = 30


class IssueKeyInput(BaseModel):
    key: str


class CreateIssueInput(BaseModel):
    project_key: str
    summary: str
    description: str = ""
    issue_type: str = "Task"
    priority: str = "Medium"
    assignee_account_id: str = ""


class UpdateIssueInput(BaseModel):
    key: str
    summary: str = ""
    priority: str = ""
    assignee_account_id: str = ""


class TransitionInput(BaseModel):
    key: str
    transition_name: str


class CommentInput(BaseModel):
    key: str
    comment: str


class AddWatcherInput(BaseModel):
    key: str
    account_id: str


class BulkTransitionInput(BaseModel):
    issue_keys: list[str]
    transition_name: str


# ── New output models ──────────────────────────────────────────────────────

class JiraWorklog(BaseModel):
    id: str
    author: str = ""
    time_spent: str = ""
    time_spent_seconds: int = 0
    started: str = ""
    comment: str = ""


class WorklogAdded(BaseModel):
    id: str
    issue_key: str
    time_spent: str = ""


class JiraIssueLink(BaseModel):
    id: str
    type: str = ""
    inward_issue: str = ""
    outward_issue: str = ""


class IssueLinkCreated(BaseModel):
    status: str = "created"


class JiraVersion(BaseModel):
    id: str
    name: str
    description: str = ""
    released: bool = False
    archived: bool = False
    release_date: str = ""


class CreatedVersion(BaseModel):
    id: str
    name: str


class JiraComponent(BaseModel):
    id: str
    name: str
    description: str = ""
    lead: str = ""
    issue_count: int = 0


class ChangelogEntry(BaseModel):
    id: str
    author: str = ""
    created: str = ""
    items: list[dict] = []


class JiraDashboard(BaseModel):
    id: str
    name: str
    owner: str = ""
    view_url: str = ""


class JiraFilter(BaseModel):
    id: str
    name: str
    owner: str = ""
    jql: str = ""
    view_url: str = ""


class DeletedIssue(BaseModel):
    key: str
    deleted: bool = True


# ── New input models ──────────────────────────────────────────────────────

class LogWorkInput(BaseModel):
    key: str
    time_spent: str  # e.g. "2h", "30m", "1d"
    comment: str = ""
    started: str = ""  # ISO datetime


class LinkIssuesInput(BaseModel):
    inward_key: str
    outward_key: str
    link_type: str = "Relates"


class CreateVersionInput(BaseModel):
    project_key: str
    name: str
    description: str = ""
    release_date: str = ""
