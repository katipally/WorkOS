-- Migration 003: AI Panel + Meetings + RAG tables
-- Requires: pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- AI Settings (key-value store for model configuration)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default settings
INSERT INTO ai_settings (key, value) VALUES
  ('ai_provider', 'openai'),
  ('ai_model', 'gpt-4o'),
  ('embedding_provider', 'openai'),
  ('embedding_model', 'text-embedding-3-small'),
  ('meeting_summary_provider', 'openai'),
  ('meeting_summary_model', 'gpt-4o-mini'),
  ('meeting_actions_provider', 'openai'),
  ('meeting_actions_model', 'gpt-4o-mini'),
  ('openai_api_key', ''),
  ('ollama_base_url', 'http://host.docker.internal:11434')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- Chat Sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'New Chat',
  focused_tab TEXT NOT NULL DEFAULT 'slack',
  scope       TEXT NOT NULL DEFAULT 'workspace',
  branch_id   INT NOT NULL DEFAULT 1,
  max_branch  INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Chat Messages
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  branch_id   INT NOT NULL DEFAULT 1,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  tool_calls  JSONB DEFAULT '[]'::jsonb,
  tool_name   TEXT DEFAULT NULL,
  tool_result JSONB DEFAULT NULL,
  metadata    JSONB DEFAULT '{}'::jsonb,
  pinned      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, branch_id, created_at);

-- ============================================================
-- Documents (uploaded files for RAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    TEXT NOT NULL,
  filetype    TEXT NOT NULL DEFAULT '',
  filesize    INT NOT NULL DEFAULT 0,
  filepath    TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'upload',
  source_id   UUID DEFAULT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  error       TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Document Chunks (with pgvector embeddings)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL DEFAULT 0,
  content     TEXT NOT NULL DEFAULT '',
  metadata    JSONB DEFAULT '{}'::jsonb,
  embedding   vector(1536),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);

-- ============================================================
-- Data Index (existing app data made searchable via RAG)
-- ============================================================
CREATE TABLE IF NOT EXISTS data_index (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  metadata    JSONB DEFAULT '{}'::jsonb,
  embedding   vector(1536),
  indexed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_data_index_source ON data_index(source_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_data_index_unique ON data_index(source_type, entity_id);

-- ============================================================
-- Meetings
-- ============================================================
CREATE TABLE IF NOT EXISTS meetings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL DEFAULT 'Untitled Meeting',
  description  TEXT NOT NULL DEFAULT '',
  meeting_date TIMESTAMPTZ DEFAULT NOW(),
  status       TEXT NOT NULL DEFAULT 'pending',
  summary      TEXT DEFAULT NULL,
  action_items JSONB DEFAULT '[]'::jsonb,
  error        TEXT DEFAULT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Meeting Files
-- ============================================================
CREATE TABLE IF NOT EXISTS meeting_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  filetype    TEXT NOT NULL DEFAULT '',
  filesize    INT NOT NULL DEFAULT 0,
  filepath    TEXT NOT NULL DEFAULT '',
  mime_type   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  transcription TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_meeting_files_meeting ON meeting_files(meeting_id);
