"""GitHub service configuration for WorkOS."""

SERVICE_NAME = "GitHub"

SERVICE_TOOL_PREFIX = "github_"

SERVICE_INSTRUCTIONS = """\
### 🐙 GitHub

You have full access to a connected GitHub account. Available operations:

**Repositories**: List repos (`github_list_repos`), get repo details \
(`github_get_repo`), search repos (`github_search_repos`).

**Issues**: List (`github_list_issues`), create (`github_create_issue`), \
get details (`github_get_issue`), update (`github_update_issue`), \
search (`github_search_issues`).

**Pull Requests**: List PRs (`github_list_pull_requests`), get PR details \
(`github_get_pull_request`), create PRs (`github_create_pull_request`).

**Commits**: List commits (`github_list_commits`).

**Gists**: List gists (`github_list_gists`), create gists (`github_create_gist`).

**Users**: Get user profiles (`github_get_user`).

**Tips**:
- Most tools need `owner` and `repo` parameters (e.g., owner="facebook", repo="react").
- Issue/PR search supports GitHub qualifiers: `is:open`, `label:bug`, \
`author:username`, `repo:owner/name`.
- When creating issues, use markdown for the body.
- PR creation needs `head` (source branch) and `base` (target branch).
- Use `github_search_repos` with qualifiers like `language:python stars:>1000`.
"""

DELEGATION_DESCRIPTION = """\
Delegate a complex GitHub task to the specialized GitHub agent. \
Use this for multi-step GitHub workflows like: \
searching issues then creating related PRs, \
reviewing a PR's commits and summarizing changes, \
creating an issue with labels and assigning it, \
or any task requiring multiple sequential GitHub API calls. \
For simple single-tool calls (listing repos, getting one issue), \
use the GitHub tools directly instead.\
"""
