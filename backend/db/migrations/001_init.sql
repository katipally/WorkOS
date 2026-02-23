-- AI Workforce Assistant — schema (v3)
-- Only table: oauth_tokens for GitHub / Slack / Atlassian OAuth2 tokens.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS oauth_tokens (
    provider      TEXT PRIMARY KEY,          -- 'github' | 'slack' | 'atlassian'
    access_token  TEXT NOT NULL,
    refresh_token TEXT,
    token_type    TEXT DEFAULT 'Bearer',
    scope         TEXT,
    expires_at    TIMESTAMPTZ,               -- NULL means non-expiring (GitHub PAT-style)
    meta          JSONB DEFAULT '{}',        -- provider-specific extras (team_id, cloud_id, etc.)
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
