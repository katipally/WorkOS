-- Integration data tables + tool cache (v4.0)
-- Adds per-integration tables for cached/synced data, and a generic tool_cache.

-- ═══════════════════════════════════════════════════════════════════════════
-- TOOL CACHE  (generic TTL cache for any tool)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tool_cache (
    tool_name   TEXT        NOT NULL,
    cache_key   TEXT        NOT NULL,
    result      JSONB       NOT NULL DEFAULT '{}',
    cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tool_name, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_cache_expires ON tool_cache (expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- SLACK
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS slack_channels (
    channel_id   TEXT PRIMARY KEY,
    channel_name TEXT NOT NULL DEFAULT '',
    is_private   BOOLEAN NOT NULL DEFAULT FALSE,
    num_members  INT NOT NULL DEFAULT 0,
    topic        TEXT NOT NULL DEFAULT '',
    purpose      TEXT NOT NULL DEFAULT '',
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS slack_users (
    user_id      TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    is_bot       BOOLEAN NOT NULL DEFAULT FALSE,
    synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- GITHUB
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS github_repos (
    id             BIGINT PRIMARY KEY,
    full_name      TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    language       TEXT NOT NULL DEFAULT '',
    stars          INT NOT NULL DEFAULT 0,
    forks          INT NOT NULL DEFAULT 0,
    open_issues    INT NOT NULL DEFAULT 0,
    is_private     BOOLEAN NOT NULL DEFAULT FALSE,
    html_url       TEXT NOT NULL DEFAULT '',
    default_branch TEXT NOT NULL DEFAULT 'main',
    updated_at     TIMESTAMPTZ,
    synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- JIRA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS jira_projects (
    id         TEXT PRIMARY KEY,
    key        TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL DEFAULT '',
    type       TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
