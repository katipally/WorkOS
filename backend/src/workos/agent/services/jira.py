"""Jira service configuration for WorkOS."""

SERVICE_NAME = "Jira"

SERVICE_TOOL_PREFIX = "jira_"

SERVICE_INSTRUCTIONS = """\
### 📋 Jira

You have full access to a connected Jira workspace. Available operations:

**Issues**: Search issues (`jira_search_issues`), get issue details \
(`jira_get_issue`), create issues (`jira_create_issue`), update issues \
(`jira_update_issue`), transition issues (`jira_transition_issue`), \
add comments (`jira_add_comment`).

**Projects**: List all projects (`jira_list_projects`).

**Boards & Sprints**: Get board details (`jira_get_board`), \
list active sprints (`jira_list_sprints`).

**Tips**:
- Use JQL (Jira Query Language) for powerful searches, e.g., \
`project = SCRUM AND status = "In Progress"`.
- When creating issues, provide `project_key`, `summary`, and `issue_type` \
(default: "Task"). Optional: `description`, `priority`, `assignee`, `labels`.
- Transitions move issues between statuses (e.g., "To Do" → "In Progress" → "Done"). \
Use `jira_get_issue` first to see available transitions.
- Issue descriptions support Atlassian Document Format (ADF) but you can \
pass plain text which will be auto-converted.
"""

DELEGATION_DESCRIPTION = """\
Delegate a complex Jira task to the specialized Jira agent. \
Use this for multi-step Jira workflows like: \
searching for issues then updating them in bulk, \
creating an issue and immediately transitioning it, \
checking sprint status and summarizing progress, \
or any task requiring multiple sequential Jira API calls. \
For simple single-tool calls (listing projects, getting one issue), \
use the Jira tools directly instead.\
"""
