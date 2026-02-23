-- OAuth pending states — moved from in-memory dict to DB for multi-worker safety.

CREATE TABLE IF NOT EXISTS oauth_pending_states (
    state       TEXT PRIMARY KEY,
    provider    TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
);

-- Auto-cleanup index for expired states
CREATE INDEX IF NOT EXISTS idx_oauth_pending_states_expires
    ON oauth_pending_states (expires_at);
