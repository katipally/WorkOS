# WorkOS — AI Agent with ReAct Loop

A full-stack AI agent with a chat interface powered by a ReAct (Reason + Act) loop. Supports tool calling via MCP servers, streaming responses, and conversation persistence.

Built with **LangGraph** (Python) for the agent backend and **Next.js** with **prompt-kit** for the chat UI.

## Architecture

```
┌─────────────┐     SSE      ┌──────────────┐    MCP     ┌────────────┐
│  Next.js UI │◄────────────►│ FastAPI + │◄──────────►│ MCP Servers│
│ (prompt-kit)│  REST/Stream │ LangGraph    │            │ (stdio/HTTP)│
└─────────────┘              └──────┬───────┘            └────────────┘
                                    │
                              ┌─────▼─────┐
                              │  Ollama    │
                              │ (Local LLM)│
                              └───────────┘
```

### ReAct Loop

```
User Message → Reason (LLM) → Check Done? ─► Yes → Return Response
                    ▲              │
                    │              ▼ No
                    └──── Act (Tool Call) ◄── Approval (if required)
```

## Features

- **ReAct Agent**: Iterative reasoning and tool-calling loop via LangGraph
- **MCP Integration**: Connect any MCP-compatible tool server (stdio or HTTP)
- **Streaming**: Real-time SSE streaming of text, thinking, and tool calls
- **Tool Approval**: Optional human-in-the-loop approval for tool calls
- **Conversation Persistence**: SQLite-backed thread and message history
- **Local LLMs**: Runs entirely on local Ollama models — no cloud API keys needed
- **Thinking Display**: Parses and displays model reasoning/thinking content
- **Dark/Light Theme**: Toggleable UI theme

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4 |
| UI Lib   | shadcn/ui + prompt-kit                  |
| State    | Zustand                                 |
| Backend  | Python 3.12, FastAPI, uvicorn           |
| Agent    | LangGraph (StateGraph, ReAct pattern)   |
| LLM      | Ollama (langchain-ollama)               |
| MCP      | langchain-mcp-adapters                  |
| Database | SQLite + aiosqlite                      |
| Deploy   | Docker Compose + Nginx                  |

## Prerequisites

- **Python 3.12+**
- **Node.js 22+**
- **[uv](https://docs.astral.sh/uv/)** — Python package manager
- **[Ollama](https://ollama.com/)** — running locally with at least one model pulled

```bash
# Pull a model (example)
ollama pull qwen3:8b
```

## Quick Start

### 1. Backend

```bash
cd backend
uv sync

# Start the server
PYTHONPATH=src uv run uvicorn workos.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`. Health check: `GET /api/health`.

### 2. Frontend

```bash
cd frontend
npm install

# Start the dev server
npm run dev
```

Open `http://localhost:3000` in your browser.

### 3. Docker (alternative)

```bash
# Start everything (requires Ollama running on host)
docker compose up --build
```

Access the app at `http://localhost` (port 80 via Nginx).

## Project Structure

```
workos-main/
├── backend/
│   ├── src/workos/
│   │   ├── main.py              # FastAPI app entry point
│   │   ├── config.py            # Settings (env vars)
│   │   ├── api/                 # REST API routers
│   │   │   ├── chat.py          # SSE streaming chat endpoint
│   │   │   ├── threads.py       # Thread/message CRUD
│   │   │   ├── models.py        # Ollama model listing
│   │   │   ├── mcp_servers.py   # MCP server management
│   │   │   └── settings.py      # App settings
│   │   ├── agent/               # LangGraph ReAct agent
│   │   │   ├── graph.py         # StateGraph definition
│   │   │   ├── nodes.py         # Reason node (LLM call)
│   │   │   ├── edges.py         # Conditional routing
│   │   │   ├── state.py         # Agent state schema
│   │   │   └── checkpointer.py  # Conversation checkpoints
│   │   ├── mcp/                 # MCP server integration
│   │   │   ├── manager.py       # Server lifecycle
│   │   │   └── registry.py      # Server config CRUD
│   │   ├── db/                  # Database layer
│   │   │   ├── database.py      # Connection management
│   │   │   ├── migrations.py    # Schema migrations
│   │   │   └── models.py        # Pydantic models
│   │   ├── streaming/
│   │   │   └── sse.py           # SSE event formatters
│   │   └── utils/
│   │       ├── thinking.py      # <think> tag parser
│   │       └── summarizer.py    # Message summarization
│   └── tests/
│       └── test_api.py
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx         # Main page
│       │   └── layout.tsx       # Root layout
│       ├── components/
│       │   ├── chat/            # Chat UI components
│       │   ├── settings/        # Settings dialog
│       │   └── ui/              # shadcn/ui + prompt-kit
│       ├── stores/              # Zustand state stores
│       └── lib/
│           ├── types.ts         # TypeScript types
│           ├── api.ts           # API client
│           └── sse-parser.ts    # SSE stream parser
├── docker/
│   └── nginx/nginx.conf
├── docker-compose.yml
└── README.md
```

## Configuration

Environment variables (backend):

| Variable              | Default                  | Description              |
|-----------------------|--------------------------|--------------------------|
| `WORKOS_OLLAMA_URL`   | `http://localhost:11434`  | Ollama API URL           |
| `WORKOS_OLLAMA_MODEL` | `qwen3:8b`               | Default model            |
| `WORKOS_MAX_STEPS`    | `25`                     | Max ReAct loop steps     |
| `WORKOS_DATABASE_PATH`| `data/workos.db`         | SQLite database path     |
| `WORKOS_CORS_ORIGINS` | `http://localhost:3000`   | Allowed CORS origins     |

Environment variables (frontend):

| Variable              | Default                  | Description              |
|-----------------------|--------------------------|--------------------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000`   | Backend API URL          |

## API Endpoints

| Method | Path                         | Description                    |
|--------|------------------------------|--------------------------------|
| GET    | `/api/health`                | Health check                   |
| POST   | `/api/chat/stream`           | Stream chat response (SSE)     |
| POST   | `/api/chat/cancel`           | Cancel in-flight request       |
| POST   | `/api/chat/approve`          | Approve/reject a tool call     |
| GET    | `/api/threads`               | List all threads               |
| POST   | `/api/threads`               | Create a new thread            |
| GET    | `/api/threads/{id}`          | Get thread details             |
| DELETE | `/api/threads/{id}`          | Delete a thread                |
| GET    | `/api/threads/{id}/messages` | Get messages for a thread      |
| GET    | `/api/threads/{id}/export`   | Export thread as markdown      |
| GET    | `/api/models`                | List available Ollama models   |
| GET    | `/api/models/current`        | Get current model              |
| GET    | `/api/mcp-servers`           | List MCP server configs        |
| POST   | `/api/mcp-servers`           | Add an MCP server              |
| DELETE | `/api/mcp-servers/{id}`      | Remove an MCP server           |
| GET    | `/api/mcp-servers/tools`     | List all available MCP tools   |
| GET    | `/api/settings`              | Get app settings               |
| PUT    | `/api/settings`              | Update app settings            |

## Adding MCP Servers

Use the Settings dialog in the UI, or call the API directly:

```bash
# Add a stdio-based MCP server
curl -X POST http://localhost:8000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GitHub",
    "transport": "stdio",
    "command": "uvx",
    "args": ["mcp-server-github"],
    "env": {"GITHUB_TOKEN": "ghp_..."}
  }'
```

## Running Tests

```bash
cd backend
PYTHONPATH=src uv run pytest tests/ -v
```

## License

MIT
