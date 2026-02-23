"""
Jira write tools — create/update issues, transitions, comments, watchers.
"""

from __future__ import annotations

import asyncio

from services.jira_client import _jira
from tools import tool
from tools.jira.models import (
    AddWatcherInput,
    BulkTransitionInput,
    BulkTransitionResult,
    CommentInput,
    CommentResult,
    CreateIssueInput,
    CreateVersionInput,
    CreatedIssue,
    CreatedVersion,
    DeletedIssue,
    IssueLinkCreated,
    IssueKeyInput,
    LinkIssuesInput,
    LogWorkInput,
    TransitionInput,
    TransitionResult,
    UpdatedIssue,
    UpdateIssueInput,
    WatcherAdded,
    WorklogAdded,
)
from tools.jira.sync import _jira_exc


# ── create issue ──────────────────────────────────────────────────────────

@tool(
    name="jira_create_issue",
    description="Create a new issue in a Jira project",
    integration="jira",
    method="POST",
    path="/issues",
    idempotent=False,
)
async def jira_create_issue(inp: CreateIssueInput) -> CreatedIssue:
    try:
        fields: dict = {
            "project": {"key": inp.project_key},
            "summary": inp.summary,
            "issuetype": {"name": inp.issue_type},
            "priority": {"name": inp.priority},
        }
        if inp.description:
            fields["description"] = {
                "type": "doc",
                "version": 1,
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": inp.description}]}
                ],
            }
        if inp.assignee_account_id:
            fields["assignee"] = {"accountId": inp.assignee_account_id}
        data = await _jira("POST", "/issue", json_body={"fields": fields})
        return CreatedIssue(key=data.get("key"), id=data.get("id"))
    except Exception as e:
        raise _jira_exc(e)


# ── update issue ──────────────────────────────────────────────────────────

@tool(
    name="jira_update_issue",
    description="Update fields on a Jira issue",
    integration="jira",
    method="PATCH",
    path="/issues/{key}",
    idempotent=False,
)
async def jira_update_issue(inp: UpdateIssueInput) -> UpdatedIssue:
    try:
        fields: dict = {}
        if inp.summary:
            fields["summary"] = inp.summary
        if inp.priority:
            fields["priority"] = {"name": inp.priority}
        if inp.assignee_account_id:
            fields["assignee"] = {"accountId": inp.assignee_account_id}
        if not fields:
            return UpdatedIssue(key=inp.key, updated=[])
        await _jira("PUT", f"/issue/{inp.key}", json_body={"fields": fields})
        return UpdatedIssue(key=inp.key, updated=list(fields.keys()))
    except Exception as e:
        raise _jira_exc(e)


# ── transition issue ─────────────────────────────────────────────────────

@tool(
    name="jira_transition_issue",
    description="Move a Jira issue to a different status",
    integration="jira",
    method="POST",
    path="/issues/{key}/transition",
    idempotent=False,
)
async def jira_transition_issue(inp: TransitionInput) -> TransitionResult:
    try:
        transitions_data = await _jira("GET", f"/issue/{inp.key}/transitions")
        transitions = transitions_data.get("transitions", [])
        match = next(
            (t for t in transitions if t["name"].lower() == inp.transition_name.lower()),
            None,
        )
        if not match:
            return TransitionResult(
                key=inp.key,
                error=f"Transition '{inp.transition_name}' not found.",
                available=[t["name"] for t in transitions],
            )
        await _jira("POST", f"/issue/{inp.key}/transitions", json_body={"transition": {"id": match["id"]}})
        return TransitionResult(key=inp.key, transitioned_to=match["name"])
    except Exception as e:
        raise _jira_exc(e)


# ── add comment ───────────────────────────────────────────────────────────

@tool(
    name="jira_add_comment",
    description="Add a comment to a Jira issue",
    integration="jira",
    method="POST",
    path="/issues/{key}/comment",
    idempotent=False,
)
async def jira_add_comment(inp: CommentInput) -> CommentResult:
    try:
        body = {
            "type": "doc",
            "version": 1,
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": inp.comment}]}
            ],
        }
        data = await _jira("POST", f"/issue/{inp.key}/comment", json_body={"body": body})
        return CommentResult(id=data.get("id"), issue_key=inp.key)
    except Exception as e:
        raise _jira_exc(e)


# ── add watcher ───────────────────────────────────────────────────────────

@tool(
    name="jira_add_watcher",
    description="Add a watcher to a Jira issue",
    integration="jira",
    method="POST",
    path="/issues/{key}/watchers",
    idempotent=False,
)
async def jira_add_watcher(inp: AddWatcherInput) -> WatcherAdded:
    try:
        # Jira's add-watcher API expects a raw JSON string (account ID) as the body
        await _jira("POST", f"/issue/{inp.key}/watchers", json_body=inp.account_id)
        return WatcherAdded(issue_key=inp.key, added=inp.account_id)
    except Exception as e:
        raise _jira_exc(e)


# ── bulk transition ───────────────────────────────────────────────────────

@tool(
    name="jira_bulk_transition",
    description="Transition multiple Jira issues at once",
    integration="jira",
    method="POST",
    path="/issues/bulk-transition",
    idempotent=False,
)
async def jira_bulk_transition(inp: BulkTransitionInput) -> BulkTransitionResult:
    results = []
    for key in inp.issue_keys:
        try:
            transitions_data = await _jira("GET", f"/issue/{key}/transitions")
            transitions = transitions_data.get("transitions", [])
            match = next(
                (t for t in transitions if t["name"].lower() == inp.transition_name.lower()),
                None,
            )
            if match:
                await _jira("POST", f"/issue/{key}/transitions", json_body={"transition": {"id": match["id"]}})
                results.append({"key": key, "status": "ok", "transitioned_to": match["name"]})
            else:
                results.append({"key": key, "status": "not_found", "available": [t["name"] for t in transitions]})
        except Exception as e:
            results.append({"key": key, "status": "error", "detail": str(e)[:100]})
        await asyncio.sleep(0.05)
    return BulkTransitionResult(results=results)


# ── log work ──────────────────────────────────────────────────────────────

@tool(
    name="jira_log_work",
    description="Log time/work on a Jira issue",
    integration="jira",
    method="POST",
    path="/issues/{key}/worklog",
    idempotent=False,
)
async def jira_log_work(inp: LogWorkInput) -> WorklogAdded:
    try:
        payload: dict = {"timeSpent": inp.time_spent}
        if inp.comment:
            payload["comment"] = {
                "type": "doc", "version": 1,
                "content": [{"type": "paragraph", "content": [{"type": "text", "text": inp.comment}]}],
            }
        if inp.started:
            payload["started"] = inp.started
        data = await _jira("POST", f"/issue/{inp.key}/worklog", json_body=payload)
        return WorklogAdded(id=data["id"], issue_key=inp.key, time_spent=data.get("timeSpent", ""))
    except Exception as e:
        raise _jira_exc(e)


# ── link issues ───────────────────────────────────────────────────────────

@tool(
    name="jira_link_issues",
    description="Create a link between two Jira issues",
    integration="jira",
    method="POST",
    path="/issue-links",
    idempotent=False,
)
async def jira_link_issues(inp: LinkIssuesInput) -> IssueLinkCreated:
    try:
        await _jira("POST", "/issueLink", json_body={
            "type": {"name": inp.link_type},
            "inwardIssue": {"key": inp.inward_key},
            "outwardIssue": {"key": inp.outward_key},
        })
        return IssueLinkCreated(status="created")
    except Exception as e:
        raise _jira_exc(e)


# ── create version ────────────────────────────────────────────────────────

@tool(
    name="jira_create_version",
    description="Create a new version (release) in a Jira project",
    integration="jira",
    method="POST",
    path="/versions",
    idempotent=False,
)
async def jira_create_version(inp: CreateVersionInput) -> CreatedVersion:
    try:
        payload: dict = {
            "name": inp.name,
            "projectId": "",
        }
        # We need the project ID; resolve from the project key
        proj_data = await _jira("GET", f"/project/{inp.project_key}")
        payload["projectId"] = proj_data["id"]
        if inp.description:
            payload["description"] = inp.description
        if inp.release_date:
            payload["releaseDate"] = inp.release_date
        data = await _jira("POST", "/version", json_body=payload)
        return CreatedVersion(id=data["id"], name=data["name"])
    except Exception as e:
        raise _jira_exc(e)


# ── delete issue ──────────────────────────────────────────────────────────

@tool(
    name="jira_delete_issue",
    description="Delete a Jira issue",
    integration="jira",
    method="DELETE",
    path="/issues/{key}",
    idempotent=False,
)
async def jira_delete_issue(inp: IssueKeyInput) -> DeletedIssue:
    try:
        await _jira("DELETE", f"/issue/{inp.key}")
        return DeletedIssue(key=inp.key, deleted=True)
    except Exception as e:
        raise _jira_exc(e)
