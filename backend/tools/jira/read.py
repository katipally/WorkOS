"""
Jira read tools — projects, issues, sprints, watchers, velocity, etc.

Sync-backed tools (projects) read from the local DB first, falling back to
a live sync when the table is empty.  Everything else is always live.
"""

from __future__ import annotations

from db.connection import get_db_pool
from services.jira_client import _jira, _format_issue, _extract_text, get_jira_site_url
from tools import tool
from tools.base import EmptyInput
from tools.jira.models import (
    ChangelogEntry,
    IssueKeyInput,
    JiraAssignableUser,
    JiraComponent,
    JiraDashboard,
    JiraFilter,
    JiraIssue,
    JiraIssueDetail,
    JiraIssueLink,
    JiraProject,
    JiraVersion,
    JiraWorklog,
    ProjectKeyInput,
    ProjectQueryInput,
    ProjectStats,
    SearchIssuesInput,
    SprintBoard,
    SprintVelocity,
    Watchers,
)
from tools.jira.sync import _jira_exc, jira_sync_projects


# ── projects (DB-backed) ──────────────────────────────────────────────────

@tool(
    name="jira_list_projects",
    description="List Jira projects (from local DB, auto-syncs if empty)",
    integration="jira",
    method="GET",
    path="/projects",
)
async def jira_list_projects(inp: EmptyInput) -> list[JiraProject]:
    pool = await get_db_pool()
    rows = await pool.fetch("SELECT * FROM jira_projects ORDER BY key")
    if not rows:
        return await jira_sync_projects(inp)
    return [
        JiraProject(
            key=r["key"], name=r["name"], id=r["id"],
            type=r["type"], avatar=r["avatar_url"],
        )
        for r in rows
    ]


# ── project stats (live) ─────────────────────────────────────────────────

@tool(
    name="jira_get_project_stats",
    description="Get open-issue statistics for a Jira project",
    integration="jira",
    method="GET",
    path="/projects/{key}/stats",
)
async def jira_get_project_stats(inp: ProjectKeyInput) -> ProjectStats:
    try:
        data = await _jira("POST", "/search/jql", json_body={
            "jql": f"project = {inp.key} AND statusCategory != Done ORDER BY created DESC",
            "maxResults": 100,
            "fields": ["status", "priority", "issuetype"],
        })
    except Exception as e:
        raise _jira_exc(e)

    issues = data.get("issues", [])
    by_status: dict = {}
    for i in issues:
        s = i["fields"]["status"]["name"]
        by_status[s] = by_status.get(s, 0) + 1
    return ProjectStats(project=inp.key, open_count=len(issues), by_status=by_status)


# ── search issues (live) ─────────────────────────────────────────────────

@tool(
    name="jira_search_issues",
    description="Search Jira issues with JQL",
    integration="jira",
    method="GET",
    path="/issues/search",
)
async def jira_search_issues(inp: SearchIssuesInput) -> list[JiraIssue]:
    try:
        data = await _jira("POST", "/search/jql", json_body={
            "jql": inp.jql,
            "maxResults": inp.max_results,
            "fields": ["summary", "status", "assignee", "priority", "issuetype", "labels", "created", "updated"],
        })
    except Exception as e:
        raise _jira_exc(e)

    site = await get_jira_site_url()
    return [JiraIssue(**_format_issue(i, site)) for i in data.get("issues", [])]


# ── my issues (live) ──────────────────────────────────────────────────────

@tool(
    name="jira_get_my_issues",
    description="Get issues assigned to the current user",
    integration="jira",
    method="GET",
    path="/issues/me",
)
async def jira_get_my_issues(inp: EmptyInput) -> list[JiraIssue]:
    try:
        data = await _jira("POST", "/search/jql", json_body={
            "jql": "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC",
            "maxResults": 30,
            "fields": ["summary", "status", "priority", "issuetype", "updated"],
        })
    except Exception as e:
        raise _jira_exc(e)

    site = await get_jira_site_url()
    return [JiraIssue(**_format_issue(i, site)) for i in data.get("issues", [])]


# ── single issue (live) ──────────────────────────────────────────────────

@tool(
    name="jira_get_issue",
    description="Get full details for a Jira issue including comments",
    integration="jira",
    method="GET",
    path="/issues/{key}",
)
async def jira_get_issue(inp: IssueKeyInput) -> JiraIssueDetail:
    try:
        data = await _jira("GET", f"/issue/{inp.key}", params={
            "fields": "summary,status,assignee,priority,issuetype,labels,description,comment,created,updated,subtasks,parent",
        })
    except Exception as e:
        raise _jira_exc(e)

    base = _format_issue(data, await get_jira_site_url())
    comments_raw = data.get("fields", {}).get("comment", {}).get("comments", [])
    return JiraIssueDetail(
        **base,
        body=_extract_text(data.get("fields", {}).get("description")),
        comments=[
            {"author": c["author"].get("displayName", ""), "body": _extract_text(c.get("body")), "created": c["created"]}
            for c in comments_raw[-5:]
        ],
    )


# ── sprint board (live) ──────────────────────────────────────────────────

@tool(
    name="jira_get_sprint",
    description="Get current sprint board for a Jira project",
    integration="jira",
    method="GET",
    path="/sprint",
)
async def jira_get_sprint(inp: ProjectQueryInput) -> SprintBoard:
    try:
        data = await _jira("POST", "/search/jql", json_body={
            "jql": f"project = {inp.project} AND sprint in openSprints() ORDER BY status ASC",
            "maxResults": 50,
            "fields": ["summary", "status", "assignee", "priority", "issuetype"],
        })
    except Exception as e:
        raise _jira_exc(e)

    site = await get_jira_site_url()
    issues = [JiraIssue(**_format_issue(i, site)) for i in data.get("issues", [])]
    by_status: dict = {}
    for i in issues:
        by_status.setdefault(i.status, []).append(i.model_dump(mode="json"))
    return SprintBoard(total=len(issues), by_status=by_status, issues=issues)


# ── watchers (live) ───────────────────────────────────────────────────────

@tool(
    name="jira_get_watchers",
    description="Get watchers for a Jira issue",
    integration="jira",
    method="GET",
    path="/issues/{key}/watchers",
)
async def jira_get_watchers(inp: IssueKeyInput) -> Watchers:
    try:
        data = await _jira("GET", f"/issue/{inp.key}/watchers")
    except Exception as e:
        raise _jira_exc(e)

    return Watchers(
        issue_key=inp.key,
        watch_count=data.get("watchCount", 0),
        watchers=[
            {"account_id": w.get("accountId"), "display_name": w.get("displayName", "")}
            for w in data.get("watchers", [])
        ],
    )


# ── sprint velocity (live) ───────────────────────────────────────────────

@tool(
    name="jira_get_sprint_velocity",
    description="Get sprint velocity metrics for a Jira project",
    integration="jira",
    method="GET",
    path="/sprint/velocity",
)
async def jira_get_sprint_velocity(inp: ProjectQueryInput) -> SprintVelocity:
    try:
        data = await _jira("POST", "/search/jql", json_body={
            "jql": f"project = {inp.project} AND sprint in closedSprints() ORDER BY updated DESC",
            "maxResults": 100,
            "fields": ["status", "story_points", "customfield_10016", "summary"],
        })
    except Exception as e:
        raise _jira_exc(e)

    issues = data.get("issues", [])
    done = [
        i for i in issues
        if i.get("fields", {}).get("status", {}).get("statusCategory", {}).get("key") == "done"
    ]
    total_points = sum(float(i["fields"].get("customfield_10016") or 0) for i in done)
    return SprintVelocity(
        project=inp.project,
        closed_sprint_issues=len(issues),
        done_issues=len(done),
        total_story_points=total_points,
    )


# ── assignable users (live) ──────────────────────────────────────────────

@tool(
    name="jira_get_assignable_users",
    description="Get users assignable to issues in a Jira project",
    integration="jira",
    method="GET",
    path="/projects/{key}/assignable",
)
async def jira_get_assignable_users(inp: ProjectKeyInput) -> list[JiraAssignableUser]:
    try:
        data = await _jira("GET", "/user/assignable/search", params={"project": inp.key, "maxResults": 50})
    except Exception as e:
        raise _jira_exc(e)

    return [
        JiraAssignableUser(
            account_id=u.get("accountId"),
            display_name=u.get("displayName", ""),
            email=u.get("emailAddress", ""),
        )
        for u in data
    ]


# ── worklogs (live) ──────────────────────────────────────────────────────

@tool(
    name="jira_get_worklogs",
    description="Get worklogs (time tracking entries) for a Jira issue",
    integration="jira",
    method="GET",
    path="/issues/{key}/worklogs",
)
async def jira_get_worklogs(inp: IssueKeyInput) -> list[JiraWorklog]:
    try:
        data = await _jira("GET", f"/issue/{inp.key}/worklog")
    except Exception as e:
        raise _jira_exc(e)

    return [
        JiraWorklog(
            id=w["id"],
            author=w.get("author", {}).get("displayName", ""),
            time_spent=w.get("timeSpent", ""),
            time_spent_seconds=w.get("timeSpentSeconds", 0),
            started=w.get("started", ""),
            comment=_extract_text(w.get("comment")) if w.get("comment") else "",
        )
        for w in data.get("worklogs", [])
    ]


# ── issue links (live) ───────────────────────────────────────────────────

@tool(
    name="jira_get_issue_links",
    description="Get issue links for a Jira issue",
    integration="jira",
    method="GET",
    path="/issues/{key}/links",
)
async def jira_get_issue_links(inp: IssueKeyInput) -> list[JiraIssueLink]:
    try:
        data = await _jira("GET", f"/issue/{inp.key}", params={"fields": "issuelinks"})
    except Exception as e:
        raise _jira_exc(e)

    links = data.get("fields", {}).get("issuelinks", [])
    return [
        JiraIssueLink(
            id=lk["id"],
            type=lk.get("type", {}).get("name", ""),
            inward_issue=lk.get("inwardIssue", {}).get("key", ""),
            outward_issue=lk.get("outwardIssue", {}).get("key", ""),
        )
        for lk in links
    ]


# ── labels (live) ────────────────────────────────────────────────────────

@tool(
    name="jira_list_labels",
    description="List all labels available in a Jira project",
    integration="jira",
    method="GET",
    path="/labels",
)
async def jira_list_labels(inp: EmptyInput) -> list[str]:
    try:
        data = await _jira("GET", "/label")
    except Exception as e:
        raise _jira_exc(e)

    return data.get("values", [])[:200]


# ── versions (live) ──────────────────────────────────────────────────────

@tool(
    name="jira_list_versions",
    description="List versions (releases) in a Jira project",
    integration="jira",
    method="GET",
    path="/projects/{key}/versions",
)
async def jira_list_versions(inp: ProjectKeyInput) -> list[JiraVersion]:
    try:
        data = await _jira("GET", f"/project/{inp.key}/versions")
    except Exception as e:
        raise _jira_exc(e)

    return [
        JiraVersion(
            id=v["id"], name=v["name"],
            description=v.get("description", ""),
            released=v.get("released", False),
            archived=v.get("archived", False),
            release_date=v.get("releaseDate", ""),
        )
        for v in data
    ]


# ── components (live) ────────────────────────────────────────────────────

@tool(
    name="jira_list_components",
    description="List components in a Jira project",
    integration="jira",
    method="GET",
    path="/projects/{key}/components",
)
async def jira_list_components(inp: ProjectKeyInput) -> list[JiraComponent]:
    try:
        data = await _jira("GET", f"/project/{inp.key}/components")
    except Exception as e:
        raise _jira_exc(e)

    return [
        JiraComponent(
            id=c["id"], name=c["name"],
            description=c.get("description", ""),
            lead=c.get("lead", {}).get("displayName", "") if c.get("lead") else "",
            issue_count=c.get("issueCount", 0),
        )
        for c in data
    ]


# ── issue changelog (live) ───────────────────────────────────────────────

@tool(
    name="jira_get_issue_changelog",
    description="Get the changelog (history) of a Jira issue",
    integration="jira",
    method="GET",
    path="/issues/{key}/changelog",
)
async def jira_get_issue_changelog(inp: IssueKeyInput) -> list[ChangelogEntry]:
    try:
        data = await _jira("GET", f"/issue/{inp.key}/changelog")
    except Exception as e:
        raise _jira_exc(e)

    values = data.get("values", [])
    return [
        ChangelogEntry(
            id=entry["id"],
            author=entry.get("author", {}).get("displayName", ""),
            created=entry.get("created", ""),
            items=[
                {
                    "field": item.get("field", ""),
                    "from": item.get("fromString", ""),
                    "to": item.get("toString", ""),
                }
                for item in entry.get("items", [])
            ],
        )
        for entry in values[-30:]  # last 30 entries
    ]


# ── dashboards (live) ────────────────────────────────────────────────────

@tool(
    name="jira_list_dashboards",
    description="List Jira dashboards accessible to the current user",
    integration="jira",
    method="GET",
    path="/dashboards",
)
async def jira_list_dashboards(inp: EmptyInput) -> list[JiraDashboard]:
    try:
        data = await _jira("GET", "/dashboard", params={"maxResults": 30})
    except Exception as e:
        raise _jira_exc(e)

    return [
        JiraDashboard(
            id=d["id"], name=d["name"],
            owner=d.get("owner", {}).get("displayName", "") if d.get("owner") else "",
            view_url=d.get("view", ""),
        )
        for d in data.get("dashboards", [])
    ]


# ── filters (live) ───────────────────────────────────────────────────────

@tool(
    name="jira_list_filters",
    description="List saved Jira filters for the current user",
    integration="jira",
    method="GET",
    path="/filters",
)
async def jira_list_filters(inp: EmptyInput) -> list[JiraFilter]:
    try:
        data = await _jira("GET", "/filter/favourite")
    except Exception as e:
        raise _jira_exc(e)

    items = data if isinstance(data, list) else []
    return [
        JiraFilter(
            id=f["id"], name=f["name"],
            owner=f.get("owner", {}).get("displayName", "") if f.get("owner") else "",
            jql=f.get("jql", ""),
            view_url=f.get("viewUrl", ""),
        )
        for f in items
    ]
