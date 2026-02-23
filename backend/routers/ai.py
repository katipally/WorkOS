"""
AI Chat Router — REST + SSE streaming endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, AIMessageChunk

from db.connection import get_pool
from services.agent.graph import get_agent_graph
from services.agent.state import AgentState
from services.agent.prompts import build_system_prompt
from services.ai_service import get_llm, list_available_models
from services.rag_service import ingest_document
from config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])

# Track active generation tasks for cancellation (guarded by _gen_lock)
_active_generations: dict[str, asyncio.Event] = {}
_gen_lock = asyncio.Lock()


# ─── Request/Response Models ─────────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    focused_tab: str = "slack"
    scope: str = "workspace"
    branch_id: int = 1
    context_mentions: list[str] = Field(default_factory=list)


class SessionCreate(BaseModel):
    title: str = "New Chat"
    focused_tab: str = "slack"
    scope: str = "workspace"


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    scope: Optional[str] = None
    branch_id: Optional[int] = None


class ApprovalRequest(BaseModel):
    session_id: str
    approved: bool


# ─── Chat SSE Endpoint ──────────────────────────────────────────────────────

@router.post("/chat")
async def chat_stream(req: ChatRequest, request: Request):
    """Stream AI chat response via SSE."""
    pool = get_pool()

    # Create or get session
    if req.session_id:
        session = await pool.fetchrow(
            "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(req.session_id)
        )
        if not session:
            raise HTTPException(404, "Session not found")
        session_id = str(session["id"])
    else:
        row = await pool.fetchrow(
            """INSERT INTO chat_sessions (title, focused_tab, scope)
               VALUES ($1, $2, $3) RETURNING id""",
            "New Chat", req.focused_tab, req.scope,
        )
        session_id = str(row["id"])

    # Save user message
    await pool.execute(
        """INSERT INTO chat_messages (session_id, branch_id, role, content)
           VALUES ($1, $2, 'user', $3)""",
        uuid.UUID(session_id), req.branch_id, req.message,
    )

    # Set up cancellation
    cancel_event = asyncio.Event()
    async with _gen_lock:
        _active_generations[session_id] = cancel_event

    async def event_generator():
        try:
            # Emit session info
            yield {
                "event": "session",
                "data": json.dumps({"session_id": session_id}),
            }

            # Build conversation history from DB
            msg_rows = await pool.fetch(
                """SELECT role, content, tool_calls, tool_name, tool_result
                   FROM chat_messages
                   WHERE session_id = $1 AND branch_id = $2
                   ORDER BY created_at""",
                uuid.UUID(session_id), req.branch_id,
            )

            from langchain_core.messages import ToolMessage

            messages = []
            for row in msg_rows:
                if row["role"] == "user":
                    messages.append(HumanMessage(content=row["content"]))
                elif row["role"] == "assistant":
                    # Reconstruct tool_calls if present
                    tc_json = json.loads(row["tool_calls"]) if row["tool_calls"] else []
                    if tc_json:
                        messages.append(AIMessage(
                            content=row["content"] or "",
                            tool_calls=[{
                                "id": tc.get("id", ""),
                                "name": tc.get("name", ""),
                                "args": tc.get("args", {}),
                            } for tc in tc_json],
                        ))
                    else:
                        messages.append(AIMessage(content=row["content"]))
                elif row["role"] == "tool":
                    messages.append(ToolMessage(
                        content=row["content"],
                        tool_call_id=row.get("tool_name") or "unknown",
                        name=row.get("tool_name") or "unknown",
                    ))

            # Build agent state
            state = AgentState(
                messages=messages,
                focused_tab=req.focused_tab,
                scope=req.scope,
                session_id=session_id,
                branch_id=req.branch_id,
                context_mentions=req.context_mentions,
            )

            # Emit thought trace — RAG retrieval
            if req.context_mentions:
                sources = ", ".join(req.context_mentions)
                yield {
                    "event": "thought",
                    "data": json.dumps({"step": f"Searching @{sources} context..."}),
                }
            elif req.scope == "tab":
                yield {
                    "event": "thought",
                    "data": json.dumps({"step": f"Searching {req.focused_tab} context..."}),
                }
            else:
                yield {
                    "event": "thought",
                    "data": json.dumps({"step": "Searching workspace context..."}),
                }

            # Run the agent graph with REAL token streaming
            graph = get_agent_graph()

            full_response = ""
            emitted_plan_ids: dict[str, int] = {}  # tool_name → plan step id
            loop_count = 0
            MAX_AGENT_LOOPS = 15
            last_tool_calls_json: str | None = None
            tool_messages_to_save: list[dict] = []
            needs_separator = False  # separator between multi-turn LLM responses

            # Use dual stream mode: "messages" for real LLM tokens,
            # "updates" for node-level outputs (tools, receipts, etc.)
            async for stream_mode, stream_data in graph.astream(
                state, stream_mode=["messages", "updates"]
            ):
                if cancel_event.is_set():
                    yield {
                        "event": "error",
                        "data": json.dumps({"message": "Generation stopped by user"}),
                    }
                    return

                # ── Real LLM Token Streaming ──────────────────────────
                if stream_mode == "messages":
                    msg_chunk, metadata = stream_data
                    # Only stream content tokens from the main LLM node
                    if (
                        metadata.get("langgraph_node") == "llm"
                        and isinstance(msg_chunk, AIMessageChunk)
                        and msg_chunk.content
                        and not getattr(msg_chunk, "tool_call_chunks", None)
                    ):
                        if needs_separator and full_response:
                            full_response += "\n\n"
                            yield {
                                "event": "token",
                                "data": json.dumps({"content": "\n\n"}),
                            }
                            needs_separator = False
                        full_response += msg_chunk.content
                        yield {
                            "event": "token",
                            "data": json.dumps({"content": msg_chunk.content}),
                        }

                # ── Node-level outputs ────────────────────────────────
                elif stream_mode == "updates":
                    loop_count += 1
                    if loop_count > MAX_AGENT_LOOPS:
                        yield {
                            "event": "error",
                            "data": json.dumps({"message": "Agent reached maximum iteration limit"}),
                        }
                        break

                    for node_name, node_output in stream_data.items():
                        if node_name == "rag_retrieval" and node_output.get("rag_context"):
                            ctx = node_output["rag_context"]
                            yield {
                                "event": "thought",
                                "data": json.dumps({
                                    "step": f"Found {len(ctx)} relevant context items",
                                }),
                            }

                        elif node_name == "llm":
                            new_messages = node_output.get("messages", [])

                            # Emit thought events from LLM reasoning
                            for thought in node_output.get("thoughts", []):
                                yield {
                                    "event": "thought",
                                    "data": json.dumps({"step": thought}),
                                }

                            # Emit plan steps if multi-tool call
                            plan_steps = node_output.get("plan_steps", [])
                            for ps in plan_steps:
                                emitted_plan_ids[ps.get("tool", "")] = ps["id"]
                                yield {
                                    "event": "plan_step",
                                    "data": json.dumps(ps),
                                }

                            for msg in new_messages:
                                if isinstance(msg, AIMessage):
                                    # Emit tool_use events
                                    if msg.tool_calls:
                                        last_tool_calls_json = json.dumps([
                                            {"id": tc.get("id", ""), "name": tc["name"], "args": tc["args"]}
                                            for tc in msg.tool_calls
                                        ])
                                        for tc in msg.tool_calls:
                                            yield {
                                                "event": "tool_use",
                                                "data": json.dumps({
                                                    "tool": tc["name"],
                                                    "input": tc["args"],
                                                    "id": tc.get("id", ""),
                                                }),
                                            }
                                    # Fallback: capture content missed by messages stream
                                    if msg.content and msg.content not in full_response:
                                        full_response += ("\n\n" if full_response else "") + msg.content

                        elif node_name == "approval_check":
                            pending = node_output.get("pending_approval")
                            if pending:
                                yield {
                                    "event": "approval",
                                    "data": json.dumps({
                                        "action": pending["tool_name"],
                                        "details": pending["tool_args"],
                                    }),
                                }
                                # Save partial response and wait for approval
                                if full_response:
                                    await pool.execute(
                                        """INSERT INTO chat_messages
                                           (session_id, branch_id, role, content, metadata)
                                           VALUES ($1, $2, 'assistant', $3, $4)""",
                                        uuid.UUID(session_id), req.branch_id,
                                        full_response,
                                        json.dumps({"pending_approval": pending}),
                                    )
                                return

                        elif node_name == "tools":
                            # Tool results
                            new_messages = node_output.get("messages", [])
                            for msg in new_messages:
                                if hasattr(msg, "name") and hasattr(msg, "content"):
                                    tool_name = getattr(msg, "name", "unknown")
                                    tool_content = msg.content[:2000] if msg.content else ""
                                    tool_call_id = getattr(msg, "tool_call_id", "")
                                    yield {
                                        "event": "tool_result",
                                        "data": json.dumps({
                                            "tool": tool_name,
                                            "output": tool_content[:500],
                                            "id": tool_call_id,
                                        }),
                                    }
                                    # Track for DB persistence
                                    tool_messages_to_save.append({
                                        "tool_name": tool_name,
                                        "content": tool_content,
                                        "tool_call_id": tool_call_id,
                                    })
                                    # Mark matching plan step as done
                                    plan_id = emitted_plan_ids.get(tool_name)
                                    if plan_id is not None:
                                        yield {
                                            "event": "plan_step",
                                            "data": json.dumps({"id": plan_id, "status": "done"}),
                                        }

                            # Emit receipts
                            receipts = node_output.get("receipts", [])
                            for rcpt in receipts:
                                yield {
                                    "event": "receipt",
                                    "data": json.dumps(rcpt),
                                }

                            # Emit action cards for write operations
                            action_cards = node_output.get("action_cards", [])
                            for ac in action_cards:
                                yield {
                                    "event": "action_card",
                                    "data": json.dumps(ac),
                                }

                            # Next LLM call should separate from previous content
                            needs_separator = True

            # Save assistant response (with tool_calls if any)
            if full_response or last_tool_calls_json:
                msg_row = await pool.fetchrow(
                    """INSERT INTO chat_messages (session_id, branch_id, role, content, tool_calls)
                       VALUES ($1, $2, 'assistant', $3, $4) RETURNING id""",
                    uuid.UUID(session_id), req.branch_id,
                    full_response or "",
                    last_tool_calls_json,
                )

                # Save tool result messages for history reconstruction
                for tm in tool_messages_to_save:
                    await pool.execute(
                        """INSERT INTO chat_messages
                           (session_id, branch_id, role, content, tool_name)
                           VALUES ($1, $2, 'tool', $3, $4)""",
                        uuid.UUID(session_id), req.branch_id,
                        tm["content"], tm["tool_name"],
                    )

                # Auto-title the session if it's the first exchange
                msg_count = await pool.fetchval(
                    "SELECT COUNT(*) FROM chat_messages WHERE session_id = $1",
                    uuid.UUID(session_id),
                )
                if msg_count <= 2:
                    # Use first ~50 chars of user message as title
                    title = req.message[:50].strip()
                    if len(req.message) > 50:
                        title += "..."
                    await pool.execute(
                        "UPDATE chat_sessions SET title = $2, updated_at = NOW() WHERE id = $1",
                        uuid.UUID(session_id), title,
                    )

                yield {
                    "event": "done",
                    "data": json.dumps({
                        "message_id": str(msg_row["id"]),
                        "session_id": session_id,
                    }),
                }
            else:
                yield {
                    "event": "done",
                    "data": json.dumps({"session_id": session_id}),
                }

        except Exception as e:
            log.exception("Chat stream error")
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)}),
            }
        finally:
            async with _gen_lock:
                _active_generations.pop(session_id, None)

    return EventSourceResponse(event_generator())


# ─── Stop Generation ─────────────────────────────────────────────────────────

class StopRequest(BaseModel):
    session_id: str


@router.post("/stop")
async def stop_generation(req: StopRequest):
    """Stop the current generation for a session."""
    async with _gen_lock:
        cancel_event = _active_generations.get(req.session_id)
    if cancel_event:
        cancel_event.set()
        return {"ok": True}
    return {"ok": False, "message": "No active generation found"}


# ─── Session CRUD ─────────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions():
    """List all chat sessions, most recent first."""
    pool = get_pool()
    rows = await pool.fetch(
        """SELECT id, title, focused_tab, scope, branch_id, max_branch,
                  created_at, updated_at
           FROM chat_sessions ORDER BY updated_at DESC"""
    )
    return [
        {
            "id": str(r["id"]),
            "title": r["title"],
            "focused_tab": r["focused_tab"],
            "scope": r["scope"],
            "branch_id": r["branch_id"],
            "max_branch": r["max_branch"],
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }
        for r in rows
    ]


@router.post("/sessions")
async def create_session(req: SessionCreate):
    """Create a new chat session."""
    pool = get_pool()
    row = await pool.fetchrow(
        """INSERT INTO chat_sessions (title, focused_tab, scope)
           VALUES ($1, $2, $3) RETURNING *""",
        req.title, req.focused_tab, req.scope,
    )
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "focused_tab": row["focused_tab"],
        "scope": row["scope"],
        "branch_id": row["branch_id"],
        "max_branch": row["max_branch"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a session with all its messages."""
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")

    messages = await pool.fetch(
        """SELECT id, branch_id, role, content, tool_calls, tool_name,
                  tool_result, metadata, pinned, created_at
           FROM chat_messages
           WHERE session_id = $1 AND branch_id = $2
           ORDER BY created_at""",
        uuid.UUID(session_id), session["branch_id"],
    )

    return {
        "id": str(session["id"]),
        "title": session["title"],
        "focused_tab": session["focused_tab"],
        "scope": session["scope"],
        "branch_id": session["branch_id"],
        "max_branch": session["max_branch"],
        "created_at": session["created_at"].isoformat(),
        "updated_at": session["updated_at"].isoformat(),
        "messages": [
            {
                "id": str(m["id"]),
                "branch_id": m["branch_id"],
                "role": m["role"],
                "content": m["content"],
                "tool_calls": json.loads(m["tool_calls"]) if m["tool_calls"] else [],
                "tool_name": m["tool_name"],
                "tool_result": json.loads(m["tool_result"]) if m["tool_result"] else None,
                "metadata": json.loads(m["metadata"]) if m["metadata"] else {},
                "pinned": m["pinned"],
                "created_at": m["created_at"].isoformat(),
            }
            for m in messages
        ],
    }


@router.patch("/sessions/{session_id}")
async def update_session(session_id: str, req: SessionUpdate):
    """Update session title or scope."""
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")

    title = req.title if req.title is not None else session["title"]
    scope = req.scope if req.scope is not None else session["scope"]
    branch_id = req.branch_id if req.branch_id is not None else session["branch_id"]

    # Clamp branch_id within valid range
    if branch_id < 1:
        branch_id = 1
    if branch_id > session["max_branch"]:
        branch_id = session["max_branch"]

    await pool.execute(
        """UPDATE chat_sessions SET title = $2, scope = $3, branch_id = $4, updated_at = NOW()
           WHERE id = $1""",
        uuid.UUID(session_id), title, scope, branch_id,
    )
    return {"ok": True, "branch_id": branch_id}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a chat session and all its messages."""
    pool = get_pool()
    await pool.execute(
        "DELETE FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    return {"ok": True}


# ─── Pin/Unpin ────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/pin/{message_id}")
async def toggle_pin(session_id: str, message_id: str):
    """Toggle pin status on a message."""
    pool = get_pool()
    row = await pool.fetchrow(
        "SELECT pinned FROM chat_messages WHERE id = $1 AND session_id = $2",
        uuid.UUID(message_id), uuid.UUID(session_id),
    )
    if not row:
        raise HTTPException(404, "Message not found")

    new_pinned = not row["pinned"]
    await pool.execute(
        "UPDATE chat_messages SET pinned = $2 WHERE id = $1",
        uuid.UUID(message_id), new_pinned,
    )
    return {"pinned": new_pinned}


# ─── Branching ────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/branch")
async def create_branch(session_id: str, from_message_id: str = Form(...)):
    """Create a new branch from a specific message."""
    pool = get_pool()
    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")

    new_branch = session["max_branch"] + 1

    # Copy messages up to the branch point
    msg = await pool.fetchrow(
        "SELECT * FROM chat_messages WHERE id = $1", uuid.UUID(from_message_id)
    )
    if not msg:
        raise HTTPException(404, "Message not found")

    # Copy all messages before and including the branch point
    earlier_msgs = await pool.fetch(
        """SELECT role, content, tool_calls, tool_name, tool_result, metadata, pinned
           FROM chat_messages
           WHERE session_id = $1 AND branch_id = $2 AND created_at <= $3
           ORDER BY created_at""",
        uuid.UUID(session_id), session["branch_id"], msg["created_at"],
    )

    for m in earlier_msgs:
        await pool.execute(
            """INSERT INTO chat_messages
               (session_id, branch_id, role, content, tool_calls, tool_name, tool_result, metadata, pinned)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            uuid.UUID(session_id), new_branch,
            m["role"], m["content"], m["tool_calls"],
            m["tool_name"], m["tool_result"], m["metadata"], m["pinned"],
        )

    # Update session
    await pool.execute(
        """UPDATE chat_sessions
           SET branch_id = $2, max_branch = $2, updated_at = NOW()
           WHERE id = $1""",
        uuid.UUID(session_id), new_branch,
    )

    return {"branch_id": new_branch, "max_branch": new_branch}


# ─── File Upload ──────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file for RAG indexing."""
    pool = get_pool()

    # Save file
    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename or "file")[1]
    filepath = os.path.join(upload_dir, f"{file_id}{ext}")

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    # Create document record
    row = await pool.fetchrow(
        """INSERT INTO documents (filename, filetype, filesize, filepath, source_type)
           VALUES ($1, $2, $3, $4, 'upload') RETURNING id""",
        file.filename or "file",
        ext.lstrip("."),
        len(content),
        filepath,
    )
    doc_id = str(row["id"])

    # Trigger ingest in background (with exception logging)
    task = asyncio.create_task(ingest_document(doc_id, filepath))

    def _ingest_done(t: asyncio.Task) -> None:
        if t.cancelled():
            log.warning("Document ingest cancelled: %s (%s)", file.filename, doc_id)
        elif exc := t.exception():
            log.error("Document ingest failed: %s (%s): %s", file.filename, doc_id, exc, exc_info=exc)

    task.add_done_callback(_ingest_done)

    return {
        "id": doc_id,
        "filename": file.filename,
        "filesize": len(content),
        "status": "processing",
    }


# ─── Approval Response ───────────────────────────────────────────────────────

@router.post("/approve")
async def handle_approval(req: ApprovalRequest):
    """Handle user approval/rejection for a pending action.

    If approved, executes the tool and re-invokes the LLM via the agent graph
    so it can reason about the result. Returns an SSE stream with tool_result,
    receipt, token, and done events — mirroring the normal chat flow.
    """
    pool = get_pool()

    session = await pool.fetchrow(
        "SELECT * FROM chat_sessions WHERE id = $1", uuid.UUID(req.session_id)
    )
    if not session:
        raise HTTPException(404, "Session not found")
    branch_id = session["branch_id"]

    msg = await pool.fetchrow(
        """SELECT id, content, metadata FROM chat_messages
           WHERE session_id = $1 AND branch_id = $2 AND role = 'assistant'
           ORDER BY created_at DESC LIMIT 1""",
        uuid.UUID(req.session_id), branch_id,
    )

    if not msg:
        raise HTTPException(404, "No pending approval found")

    metadata = json.loads(msg["metadata"]) if msg["metadata"] else {}
    pending = metadata.get("pending_approval")
    if not pending:
        raise HTTPException(400, "No pending approval on last message")

    # Clear the pending_approval metadata
    await pool.execute(
        "UPDATE chat_messages SET metadata = $2 WHERE id = $1",
        msg["id"],
        json.dumps({k: v for k, v in metadata.items() if k != "pending_approval"}),
    )

    async def approval_event_generator():
        try:
            if not req.approved:
                # Rejection — save and emit done
                await pool.execute(
                    """INSERT INTO chat_messages (session_id, branch_id, role, content)
                       VALUES ($1, $3, 'assistant', $2)""",
                    uuid.UUID(req.session_id),
                    "❌ Action cancelled by user.",
                    branch_id,
                )
                yield {
                    "event": "token",
                    "data": json.dumps({"content": "❌ Action cancelled by user."}),
                }
                yield {
                    "event": "done",
                    "data": json.dumps({"session_id": req.session_id}),
                }
                return

            # ── Approved: execute tool, then re-invoke LLM graph ──
            from services.agent.tools import AGENT_TOOLS

            tool_map = {t.name: t for t in AGENT_TOOLS}
            tool_fn = tool_map.get(pending["tool_name"])
            if not tool_fn:
                yield {
                    "event": "error",
                    "data": json.dumps({"message": f"Unknown tool: {pending['tool_name']}"}),
                }
                return

            yield {
                "event": "thought",
                "data": json.dumps({"step": f"Executing {pending['tool_name'].replace('_', ' ').title()}..."}),
            }

            try:
                result = await asyncio.wait_for(
                    tool_fn.ainvoke(pending["tool_args"]),
                    timeout=120,
                )
                result_str = str(result)[:2000]
                is_error = "error" in result_str.lower()[:200] or "failed" in result_str.lower()[:200]
            except asyncio.TimeoutError:
                result_str = "Tool execution timed out after 120s"
                is_error = True
            except Exception as e:
                result_str = f"Tool execution failed: {e}"
                is_error = True

            # Emit tool_result
            yield {
                "event": "tool_result",
                "data": json.dumps({
                    "tool": pending["tool_name"],
                    "output": result_str[:500],
                    "id": pending.get("tool_call_id", ""),
                }),
            }

            # Emit receipt
            receipt = {
                "tool": pending["tool_name"],
                "action": pending["tool_name"].replace("_", " ").title(),
                "summary": result_str[:200],
                "success": not is_error,
            }
            import re as _re
            urls = _re.findall(r'https?://[^\s"\)]+', result_str)
            if urls:
                receipt["link"] = urls[0]
            yield {
                "event": "receipt",
                "data": json.dumps(receipt),
            }

            # ── Re-invoke LLM to reason about tool result ──
            yield {
                "event": "thought",
                "data": json.dumps({"step": "Analyzing result..."}),
            }

            # Rebuild conversation history
            msg_rows = await pool.fetch(
                """SELECT role, content, tool_calls, tool_name, tool_result
                   FROM chat_messages
                   WHERE session_id = $1 AND branch_id = $2
                   ORDER BY created_at""",
                uuid.UUID(req.session_id), branch_id,
            )

            from langchain_core.messages import ToolMessage
            messages = []
            for row in msg_rows:
                if row["role"] == "user":
                    messages.append(HumanMessage(content=row["content"]))
                elif row["role"] == "assistant":
                    messages.append(AIMessage(content=row["content"]))
                elif row["role"] == "tool":
                    messages.append(ToolMessage(
                        content=row["content"],
                        tool_call_id=row.get("tool_name", "unknown"),
                        name=row.get("tool_name", "unknown"),
                    ))

            # Append a summary of the approved tool execution as context
            messages.append(HumanMessage(
                content=f"[System: The user approved the action '{pending['tool_name']}'. "
                        f"Result: {result_str[:500]}. Please analyze this result and respond to the user.]"
            ))

            # Build a fresh agent state for the follow-up LLM call
            state = AgentState(
                messages=messages,
                focused_tab=session["focused_tab"],
                scope=session["scope"],
                session_id=req.session_id,
                branch_id=branch_id,
            )

            graph = get_agent_graph()
            full_response = ""

            async for stream_mode, stream_data in graph.astream(
                state, stream_mode=["messages", "updates"]
            ):
                # ── Real token streaming from LLM ──
                if stream_mode == "messages":
                    msg_chunk, metadata = stream_data
                    if (
                        metadata.get("langgraph_node") == "llm"
                        and isinstance(msg_chunk, AIMessageChunk)
                        and msg_chunk.content
                        and not getattr(msg_chunk, "tool_call_chunks", None)
                    ):
                        full_response += msg_chunk.content
                        yield {
                            "event": "token",
                            "data": json.dumps({"content": msg_chunk.content}),
                        }

                # ── Node outputs ──
                elif stream_mode == "updates":
                    for node_name, node_output in stream_data.items():
                        if node_name == "llm":
                            for m in node_output.get("messages", []):
                                if isinstance(m, AIMessage) and m.content and m.content not in full_response:
                                    full_response += m.content

                        elif node_name == "tools":
                            new_messages = node_output.get("messages", [])
                            for m in new_messages:
                                if hasattr(m, "name") and hasattr(m, "content"):
                                    yield {
                                        "event": "tool_result",
                                        "data": json.dumps({
                                            "tool": getattr(m, "name", "unknown"),
                                            "output": m.content[:500],
                                            "id": getattr(m, "tool_call_id", ""),
                                        }),
                                    }
                            receipts = node_output.get("receipts", [])
                            for rcpt in receipts:
                                yield {
                                    "event": "receipt",
                                    "data": json.dumps(rcpt),
                                }

            # Save the full response
            if full_response:
                msg_row = await pool.fetchrow(
                    """INSERT INTO chat_messages (session_id, branch_id, role, content)
                       VALUES ($1, $2, 'assistant', $3) RETURNING id""",
                    uuid.UUID(req.session_id), branch_id, full_response,
                )
                yield {
                    "event": "done",
                    "data": json.dumps({
                        "message_id": str(msg_row["id"]),
                        "session_id": req.session_id,
                    }),
                }
            else:
                yield {
                    "event": "done",
                    "data": json.dumps({"session_id": req.session_id}),
                }

        except Exception as e:
            log.exception("Approval stream error")
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)}),
            }

    return EventSourceResponse(approval_event_generator())
