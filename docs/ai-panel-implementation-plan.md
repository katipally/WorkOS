# WorkOS AI Panel & Meetings Tab — Master Implementation Plan

> **Created**: February 2026  
> **Status**: Implementation in progress  
> **Approach**: Phased delivery — each phase produces a working system

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Phase 1 — Foundation](#phase-1--foundation)
3. [Phase 2 — Agentic Features](#phase-2--agentic-features)
4. [Phase 3 — Advanced UX & Polish](#phase-3--advanced-ux--polish)
5. [File Manifest](#file-manifest)
6. [Database Schema](#database-schema)
7. [API Contracts](#api-contracts)

---

## Architecture Overview

```
┌─────────────┐    ┌────────────────────────┐    ┌─────────────────┐
│  Frontend    │    │   Backend (FastAPI)     │    │  PostgreSQL 16  │
│  React/TS   │◄──►│                         │◄──►│  + pgvector     │
│             │SSE │  ┌──────────────────┐   │    │                 │
│  AI Panel   │◄───│  │  AI Router       │   │    │  embeddings     │
│  Meetings   │    │  │  (SSE streaming) │   │    │  chat_history   │
│  Slack      │    │  ├──────────────────┤   │    │  meetings       │
│  GitHub     │    │  │  LangGraph Agent │   │    │  documents      │
│  Settings   │    │  │  (orchestrator)  │   │    └─────────────────┘
│             │    │  ├──────────────────┤   │
│             │    │  │  RAG Pipeline    │   │    ┌─────────────────┐
│             │    │  │  (pgvector)      │   │    │  Ollama         │
│             │    │  ├──────────────────┤   │    │  (local LLM)    │
│             │    │  │  Meeting Process │   │    └─────────────────┘
│             │    │  │  (Whisper+LLM)   │   │
│             │    │  └──────────────────┘   │    ┌─────────────────┐
└─────────────┘    └────────────────────────┘    │  OpenAI API     │
                                                  └─────────────────┘
```

### Model Configuration

| Purpose | Setting Key | Providers | Default |
|---------|-------------|-----------|---------|
| AI Chat Agent | `ai_provider` + `ai_model` | OpenAI / Ollama | gpt-4o |
| Meeting Summary | `meeting_summary_provider` + `meeting_summary_model` | OpenAI / Ollama | gpt-4o-mini |
| Meeting Actions | `meeting_actions_provider` + `meeting_actions_model` | OpenAI / Ollama | gpt-4o-mini |
| Embeddings | `embedding_provider` + `embedding_model` | OpenAI / Ollama | text-embedding-3-small |
| Transcription | Local Faster-Whisper | N/A | base model |

---

## Phase 1 — Foundation

### P1.1 Database Schema (Migration 003)
- `ai_settings` — model provider/model per purpose
- `chat_sessions` — conversation metadata (title, focused_tab, scope, branch info)
- `chat_messages` — messages with role, content, tool_calls, pinned flag, branch_id
- `documents` — uploaded files metadata
- `document_chunks` — chunked text with pgvector embeddings
- `meetings` — meeting metadata (title, date, status, file paths)
- `meeting_files` — uploaded files per meeting (transcript, audio, video)

### P1.2 Backend — Config & Dependencies
- Add to `config.py`: OPENAI_API_KEY, OLLAMA_BASE_URL
- Add to `requirements.txt`: openai, langchain-core, langchain-openai, langchain-ollama, langgraph, pgvector, asyncpg (already), faster-whisper, docling, flashrank, python-multipart (already)
- Docker: Add volume for file uploads, expose Ollama network

### P1.3 Backend — AI Service Layer
- `services/ai_service.py` — Provider-agnostic LLM wrapper (OpenAI + Ollama)
- `services/embedding_service.py` — Embedding generation (OpenAI text-embedding-3-small / Ollama)
- `services/rag_service.py` — Unified retrieval (pgvector hybrid search + FlashRank reranking)
- `services/transcription_service.py` — Faster-Whisper local transcription

### P1.4 Backend — AI Agent (LangGraph)
- `services/agent/graph.py` — LangGraph StateGraph definition
- `services/agent/state.py` — Agent state schema
- `services/agent/tools.py` — Tool nodes (Slack read/write, GitHub read/write, RAG search, Meeting search)
- `services/agent/prompts.py` — System prompts with tab-awareness

### P1.5 Backend — AI Router (SSE Streaming)
- `routers/ai.py` — REST + SSE endpoints
  - `POST /api/ai/chat` — SSE stream (chat message → agent → streamed response)
  - `GET /api/ai/sessions` — list chat sessions
  - `GET /api/ai/sessions/{id}` — get session with messages
  - `POST /api/ai/sessions` — create session
  - `PATCH /api/ai/sessions/{id}` — update title/scope
  - `DELETE /api/ai/sessions/{id}` — delete session
  - `POST /api/ai/sessions/{id}/pin` — pin/unpin message
  - `POST /api/ai/upload` — file upload for RAG

### P1.6 Backend — Meetings Tools
- `tools/meetings/models.py` — Pydantic models
- `tools/meetings/read.py` — List/get meetings, get summary, get action items
- `tools/meetings/write.py` — Create meeting, upload file, process meeting
- `tools/meetings/process.py` — Background processing pipeline:
  1. If audio/video → transcribe with Faster-Whisper
  2. Parse transcript → chunk with SemanticChunker
  3. Embed chunks → store in pgvector
  4. Extract summary using meeting_summary_model
  5. Extract action items using meeting_actions_model

### P1.7 Backend — Settings Tools
- `tools/settings/models.py` — Settings I/O models
- `tools/settings/tools.py` — Get/update AI settings, list available models

### P1.8 Frontend — App Shell Updates
- Add "Meetings" tab to NAV_TABS
- Add AI panel toggle button in sidebar
- Update `Tab` type to include "meetings"
- Add `aiPanelOpen` to Zustand store
- Layout: sidebar | main content | AI panel (resizable)

### P1.9 Frontend — AI Panel Component
- `components/ai/AIPanel.tsx` — Main panel container
- `components/ai/ChatMessage.tsx` — Message renderer (asymmetric: user bubbles right, AI left)
- `components/ai/ChatInput.tsx` — Sticky input with file upload, context picker
- `components/ai/ContextBadge.tsx` — "Focused on [Tab]" badge
- `components/ai/ScopePicker.tsx` — This Tab Only / Whole Workspace toggle
- `components/ai/ContextMention.tsx` — @ mention popup (Slack/GitHub/Meetings)
- `components/ai/SessionHeader.tsx` — Breadcrumb header with chat grid overlay
- SSE consumer using EventSource for streaming responses

### P1.10 Frontend — Meetings Tab
- `components/meetings/MeetingsView.tsx` — Main meetings view
- `components/meetings/MeetingCard.tsx` — Meeting list item
- `components/meetings/MeetingDetail.tsx` — Detail view with 3 tabs:
  - **Summary** — AI-generated summary
  - **Action Items** — Extracted action items with checkboxes
  - **Preview** — Original transcript/file viewer
- `components/meetings/FileUpload.tsx` — Drag-and-drop upload zone
- Integration with AI panel: processing status, RAG indexing

### P1.11 Frontend — Settings Updates
- Add "AI Configuration" section to SettingsView
- Provider selection (OpenAI / Ollama) per purpose
- Model dropdown (fetched from API)
- API key input for OpenAI
- Ollama URL input
- Test connection button

### P1.12 Frontend — API Client Updates
- `api/client.ts` — Add `aiApi` and `meetingsApi` sections

---

## Phase 2 — Agentic Features

### P2.1 Multi-Step Task Planning (Collapsible Plans)
- Agent emits `plan_step` events during execution
- UI renders collapsible plan cards with status (pending/running/done/failed)
- `components/ai/PlanCard.tsx`

### P2.2 Interactive Action Cards
- Agent returns structured `action_card` payloads
- UI renders functional cards (confirm buttons, calendar pickers, etc.)
- `components/ai/ActionCard.tsx`

### P2.3 Transaction Logs (Receipts)
- Every tool execution emits a `receipt` event
- UI renders receipt badges with deep links
- `components/ai/ReceiptBadge.tsx`

### P2.4 Approval Gate (Human-in-the-loop)
- High-stakes actions pause with `approval_required` event
- UI renders Approve/Cancel card
- User response resumes/cancels the agent
- `components/ai/ApprovalCard.tsx`

### P2.5 Tool-Use Badges
- Each tool invocation shows a small chip in the message
- `components/ai/ToolBadge.tsx`

### P2.6 Thought Traces
- Agent emits `thought` events before final response
- Collapsible "Agent is thinking..." steps
- `components/ai/ThoughtTrace.tsx`

---

## Phase 3 — Advanced UX & Polish

### P3.1 Message Branching + Editing
- Edit previous prompts → create new branch
- Branch selector UI (Branch N of M)
- `components/ai/BranchSelector.tsx`
- Backend: branch_id tracking in chat_messages

### P3.2 Streaming + Interruption
- SSE word-by-word streaming (already in P1)
- "Stop & Correct" button during streaming
- Immediate cancellation via AbortController

### P3.3 History + Persistence
- Breadcrumb header with session title
- Grid overlay for recent chats
- Cross-tab chat history access
- `components/ai/ChatGrid.tsx`

### P3.4 Pinned Context (Active Memory)
- Thumbtack icon on messages
- Pinned messages included in agent context window
- Visual indicator for pinned messages

### P3.5 Smart Compaction + Summarization
- Auto-detect long conversations (>20 messages)
- Summarize older messages into context block
- Toggle: "Summary of previous points"

### P3.6 Rich Markdown Rendering
- Code blocks with syntax highlighting + copy button + language label
- Tables, math/LaTeX, task lists
- GitHub diff previews, Slack thread previews
- `components/ai/RichContent.tsx`

### P3.7 Copy + Export
- Copy entire AI response
- Export chat as PDF or Markdown

### P3.8 Auto-Scroll + Manual Override
- Auto-scroll during streaming
- Freeze on manual scroll up
- "Jump to bottom" button

### P3.9 Stateful Snapshots
- Link actions to app state at that moment
- Before/after comparison

---

## File Manifest

### Backend — New Files

```
backend/
├── services/
│   ├── ai_service.py          # LLM provider wrapper (OpenAI/Ollama)
│   ├── embedding_service.py   # Embedding generation
│   ├── rag_service.py         # Unified retrieval + reranking
│   └── transcription_service.py # Faster-Whisper transcription
├── routers/
│   └── ai.py                  # AI chat SSE endpoints
├── tools/
│   ├── meetings/
│   │   ├── __init__.py
│   │   ├── models.py
│   │   ├── read.py
│   │   ├── write.py
│   │   └── process.py
│   └── settings/
│       ├── __init__.py
│       ├── models.py
│       └── tools.py
├── db/
│   └── migrations/
│       └── 003_ai_meetings.sql
└── uploads/                   # Docker volume mount point
```

### Frontend — New Files

```
frontend/src/
├── components/
│   ├── ai/
│   │   ├── AIPanel.tsx        # Main AI panel container
│   │   ├── ChatMessage.tsx    # Message renderer
│   │   ├── ChatInput.tsx      # Sticky input + file upload
│   │   ├── ContextBadge.tsx   # "Focused on [Tab]" badge
│   │   ├── ScopePicker.tsx    # Scope toggle
│   │   ├── ContextMention.tsx # @ mention popup
│   │   ├── SessionHeader.tsx  # Breadcrumb + chat grid
│   │   ├── PlanCard.tsx       # Multi-step plan
│   │   ├── ActionCard.tsx     # Interactive action cards
│   │   ├── ReceiptBadge.tsx   # Transaction receipts
│   │   ├── ApprovalCard.tsx   # Human-in-the-loop
│   │   ├── ToolBadge.tsx      # Tool use chips
│   │   ├── ThoughtTrace.tsx   # Thought steps
│   │   ├── BranchSelector.tsx # Branch navigation
│   │   ├── ChatGrid.tsx       # History grid overlay
│   │   └── RichContent.tsx    # Markdown + rich previews
│   └── meetings/
│       ├── MeetingsView.tsx   # Main meetings view
│       ├── MeetingCard.tsx    # Meeting list item  
│       ├── MeetingDetail.tsx  # Detail with 3 tabs
│       └── FileUpload.tsx     # Drag-and-drop upload
├── api/
│   └── client.ts              # + aiApi, meetingsApi sections
├── store/
│   └── useAppStore.ts         # + aiPanelOpen, AI state
└── types/
    └── index.ts               # + "meetings" tab, AI types
```

---

## Database Schema

### Migration 003 — AI & Meetings Tables

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- AI Settings (one row per setting key)
CREATE TABLE ai_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Sessions
CREATE TABLE chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'New Chat',
  focused_tab TEXT NOT NULL DEFAULT 'slack',
  scope       TEXT NOT NULL DEFAULT 'workspace', -- 'tab' | 'workspace'
  branch_id   INT NOT NULL DEFAULT 1,
  max_branch  INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages
CREATE TABLE chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  branch_id   INT NOT NULL DEFAULT 1,
  role        TEXT NOT NULL, -- 'user' | 'assistant' | 'system' | 'tool'
  content     TEXT NOT NULL DEFAULT '',
  tool_calls  JSONB DEFAULT '[]',
  tool_name   TEXT DEFAULT NULL,
  tool_result JSONB DEFAULT NULL,
  metadata    JSONB DEFAULT '{}', -- plan steps, receipts, thought traces, etc.
  pinned      BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id, branch_id, created_at);

-- Documents (uploaded files for RAG)
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    TEXT NOT NULL,
  filetype    TEXT NOT NULL DEFAULT '',
  filesize    INT NOT NULL DEFAULT 0,
  filepath    TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'upload', -- 'upload' | 'meeting'
  source_id   UUID DEFAULT NULL, -- meeting_id if source_type = 'meeting'
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'ready' | 'error'
  error       TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Document Chunks (with pgvector embeddings)
CREATE TABLE document_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL DEFAULT 0,
  content     TEXT NOT NULL DEFAULT '',
  metadata    JSONB DEFAULT '{}',
  embedding   vector(1536), -- OpenAI text-embedding-3-small dimension
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_chunks_embedding ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Postgres data index (existing app data made searchable)
CREATE TABLE data_index (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL, -- 'slack_message' | 'github_issue' | 'github_pr' | 'meeting'
  entity_id   TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  metadata    JSONB DEFAULT '{}',
  embedding   vector(1536),
  indexed_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_data_index_source ON data_index(source_type, entity_id);
CREATE INDEX idx_data_index_embedding ON data_index USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Meetings
CREATE TABLE meetings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL DEFAULT 'Untitled Meeting',
  description TEXT NOT NULL DEFAULT '',
  meeting_date TIMESTAMPTZ DEFAULT NOW(),
  status      TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'ready' | 'error'
  summary     TEXT DEFAULT NULL,
  action_items JSONB DEFAULT '[]',
  error       TEXT DEFAULT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Meeting Files
CREATE TABLE meeting_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  filetype    TEXT NOT NULL DEFAULT '', -- 'transcript' | 'audio' | 'video'
  filesize    INT NOT NULL DEFAULT 0,
  filepath    TEXT NOT NULL DEFAULT '',
  mime_type   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_meeting_files_meeting ON meeting_files(meeting_id);
```

---

## API Contracts

### AI Endpoints (routers/ai.py)

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| POST | `/api/ai/chat` | Stream chat (SSE) | SSE events |
| GET | `/api/ai/sessions` | List sessions | `ChatSession[]` |
| POST | `/api/ai/sessions` | Create session | `ChatSession` |
| GET | `/api/ai/sessions/{id}` | Get session + messages | `ChatSessionDetail` |
| PATCH | `/api/ai/sessions/{id}` | Update session | `ChatSession` |
| DELETE | `/api/ai/sessions/{id}` | Delete session | `{ok: true}` |
| POST | `/api/ai/sessions/{id}/pin/{msg_id}` | Toggle pin | `{pinned: bool}` |
| POST | `/api/ai/sessions/{id}/branch` | Create branch from msg | `{branch_id: int}` |
| POST | `/api/ai/upload` | Upload file for RAG | `Document` |
| POST | `/api/ai/stop` | Stop current generation | `{ok: true}` |

### SSE Event Types (POST /api/ai/chat)

```
event: token        data: {"content": "Hello"}        # Streaming text
event: thought      data: {"step": "Searching..."}    # Thought trace
event: plan_step    data: {"id": 1, "label": "...", "status": "running"}
event: tool_use     data: {"tool": "slack_search", "input": {...}}
event: tool_result  data: {"tool": "slack_search", "output": {...}}
event: receipt      data: {"action": "Sent message", "link": "..."}
event: approval     data: {"action": "Create issue", "details": {...}}
event: done         data: {"message_id": "..."}
event: error        data: {"message": "..."}
```

### Meetings Endpoints (auto-mounted via @tool)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/meetings` | List meetings |
| POST | `/api/meetings` | Create meeting |
| GET | `/api/meetings/{id}` | Get meeting detail |
| DELETE | `/api/meetings/{id}` | Delete meeting |
| POST | `/api/meetings/{id}/upload` | Upload file to meeting |
| POST | `/api/meetings/{id}/process` | Trigger processing |
| GET | `/api/meetings/{id}/summary` | Get summary |
| GET | `/api/meetings/{id}/actions` | Get action items |

### Settings Endpoints (auto-mounted via @tool)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/ai` | Get AI settings |
| PUT | `/api/settings/ai` | Update AI settings |
| GET | `/api/settings/ai/models` | List available models |
| POST | `/api/settings/ai/test` | Test connection |

---

## Implementation Order (Within Each Phase)

### Phase 1 Execution Order:
1. ✅ Migration 003 (DB schema)
2. ✅ Backend dependencies (requirements.txt)
3. ✅ Config updates
4. ✅ AI service layer (ai_service, embedding_service, rag_service)
5. ✅ Transcription service
6. ✅ AI agent (LangGraph)
7. ✅ AI router (SSE)
8. ✅ Meeting tools
9. ✅ Settings tools
10. ✅ Frontend dependencies
11. ✅ Types + Store updates
12. ✅ API client updates
13. ✅ AI panel components
14. ✅ Meetings tab components
15. ✅ Settings UI updates
16. ✅ App shell integration
17. ✅ Docker compose updates
18. ✅ Build + test

### Phase 2 Execution Order:
1. Plan cards + agent plan emission
2. Action cards
3. Receipt badges
4. Approval gates
5. Tool badges
6. Thought traces

### Phase 3 Execution Order:
1. Message branching + editing
2. Streaming interruption
3. Chat history grid
4. Pinned context
5. Smart compaction
6. Rich content rendering
7. Copy + export
8. Auto-scroll
9. Stateful snapshots

---

## Technology Choices (as of Feb 2026)

| Component | Technology | Version | Rationale |
|-----------|-----------|---------|-----------|
| LLM Orchestration | LangGraph | 0.2.x | State machine for agent workflows, human-in-the-loop |
| LLM Provider | LangChain OpenAI + Ollama | latest | Provider-agnostic LLM calls |
| Embeddings | OpenAI text-embedding-3-small | — | 1536 dimensions, best cost/quality |
| Vector Store | pgvector | 0.7.x | Native Postgres, no extra infra |
| Chunking | LangChain SemanticChunker | — | Topic-preserving splits |
| Reranking | FlashRank | 0.2.x | Local, fast, no API needed |
| Transcription | Faster-Whisper | 1.0.x | Open-source, local, GPU optional |
| Document Parsing | Docling | 2.x | PDF/DOCX → Markdown |
| Streaming | SSE (Server-Sent Events) | — | Native browser support, simple |
| Frontend State | Zustand + React Query | — | Already in use |
