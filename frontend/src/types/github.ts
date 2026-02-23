/**
 * TypeScript interfaces for the GitHub integration views.
 * Extracted from GitHubView.tsx to be shared across sub-components.
 */

export interface Repo {
    id: number;
    full_name: string;
    name: string;
    description?: string;
    language?: string;
    stars: number;
    forks: number;
    open_issues: number;
    is_private: boolean;
    html_url?: string;
    default_branch?: string;
}

export interface Issue {
    number: number;
    title: string;
    state: string;
    assignee?: string;
    labels: string[];
    created_at: string;
    updated_at: string;
    url: string;
    body?: string;
}

export interface PR {
    number: number;
    title: string;
    state: string;
    author: string;
    base: string;
    head: string;
    draft: boolean;
    updated_at: string;
    url: string;
    requested_reviewers: string[];
}

export interface Commit {
    sha: string;
    message: string;
    author: string;
    date: string;
    url: string;
}

export interface Run {
    id: number;
    name: string;
    status: string;
    conclusion?: string;
    branch: string;
    created_at: string;
    url: string;
}

export interface Branch {
    name: string;
    sha: string;
    protected: boolean;
}

export interface PRDetail {
    number: number;
    title: string;
    state: string;
    body: string;
    author: string;
    base: string;
    head: string;
    draft: boolean;
    mergeable?: boolean;
    url: string;
    reviews: { reviewer: string; state: string; body: string }[];
    changed_files: { filename: string; status: string; additions: number; deletions: number }[];
}

export interface Release {
    id: number;
    tag_name: string;
    name: string;
    body: string;
    draft: boolean;
    prerelease: boolean;
    created_at: string;
    published_at: string;
    html_url: string;
    author: string;
}

export interface Contributor {
    login: string;
    avatar_url: string;
    contributions: number;
    html_url: string;
}

export interface GHMilestone {
    number: number;
    title: string;
    state: string;
    description: string;
    open_issues: number;
    closed_issues: number;
    due_on: string;
    html_url: string;
}

export interface CodeSearchResult {
    path: string;
    repo: string;
    sha: string;
    score: number;
    html_url: string;
    text_matches: string[];
}

export interface IssueDetail {
    number: number;
    title: string;
    state: string;
    body: string;
    author: string;
    assignee?: string;
    labels: string[];
    created_at: string;
    updated_at: string;
    url: string;
    milestone?: string;
    comments: { author: string; body: string; created_at: string }[];
}

export interface FileContent {
    path: string;
    name: string;
    type: string;
    content: string;
    size: number;
    sha: string;
    html_url: string;
    encoding: string;
}

export interface DirEntry {
    name: string;
    path: string;
    type: string;
    size: number;
    sha: string;
    html_url: string;
}

export type GHTab =
    | "code"
    | "issues"
    | "prs"
    | "actions"
    | "commits"
    | "branches"
    | "releases"
    | "contributors"
    | "milestones"
    | "search";
