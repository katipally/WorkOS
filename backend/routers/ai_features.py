"""
AI Features Router — branching, pinning, file upload, and approval endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from langchain_core.messages import AIMessage, AIMessageChunk
from sse_starlette.sse import EventSourceResponse

from db.connection import get_pool
from schemas.ai import ApprovalRequest
from services.chat_helpers import build_message_history
from services.agent.graph import get_agent_graph
from services.agent.state import AgentState
from services.agent.config import APPROVAL_TIMEOUT_SECONDS
from services.rag_service import ingest_document
from config import settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])


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

    upload_dir = settings.UPLOAD_DIR
    os.makedirs(upload_dir, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename or "file")[1]
    filepath = os.path.join(upload_dir, f"{file_id}{ext}")

    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)

    row = await pool.fetchrow(
        """INSERT INTO documents (filename, filetype, filesize, filepath, source_type)
           VALUES ($1, $2, $3, $4, 'upload') RETURNING id""",
        file.filename or "file",
        ext.lstrip("."),
        len(content),
        filepath,
    )
    doc_id = str(row["id"])

    # Trigger ingest in background
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

    # asyncpg returns JSONB as a Python dict, not a JSON string
    raw_meta = msg["metadata"]
    if isinstance(raw_meta, str):
        metadata = json.loads(raw_meta) if raw_meta else {}
    elif isinstance(raw_meta, dict):
        metadata = raw_meta
    else:
        metadata = {}

    pending = metadata.get("pending_approval")
    if not pending:
        raise HTTPException(400, "No pending approval on last message")

    # Clear the pending_approval metadata
    cleaned_meta = {k: v for k, v in metadata.items() if k != "pending_approval"}
    await pool.execute(
        "UPDATE chat_messages SET metadata = $2::jsonb WHERE id = $1",
        msg["id"],
        json.dumps(cleaned_meta),
    )

    async def approval_event_generator():
        try:
            tool_call_id = pending.get("tool_call_id", "")

            if not req.approved:
                # ── Rejection ──────────────────────────────────────────
                # First save a ToolMessage so the AIMessage→ToolMessage
                # sequence stays valid for OpenAI's message format.
                if tool_call_id:
                    await pool.execute(
                        """INSERT INTO chat_messages
                           (session_id, branch_id, role, content,
                            tool_name, metadata)
                           VALUES ($1, $2, 'tool', $3, $4, $5::jsonb)""",
                        uuid.UUID(req.session_id), branch_id,
                        "Action cancelled by user.",
                        pending["tool_name"],
                        json.dumps({"tool_call_id": tool_call_id}),
                    )
                # Then save a normal assistant message
                await pool.execute(
                    """INSERT INTO chat_messages
                       (session_id, branch_id, role, content)
                       VALUES ($1, $2, 'assistant', $3)""",
                    uuid.UUID(req.session_id), branch_id,
                    "❌ Action cancelled by user.",
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

            # ── Approved: execute tool ─────────────────────────────────
            from services.agent.tools import (
                AGENT_TOOLS, get_tools_for_context, _get_connected_providers,
            )

            tool_map = {t.name: t for t in AGENT_TOOLS}
            tool_fn = tool_map.get(pending["tool_name"])
            if not tool_fn:
                yield {
                    "event": "error",
                    "data": json.dumps(
                        {"message": f"Unknown tool: {pending['tool_name']}"}
                    ),
                }
                return

            yield {
                "event": "thought",
                "data": json.dumps({
                    "step": f"Executing {pending['tool_name'].replace('_', ' ').title()}..."
                }),
            }

            try:
                result = await asyncio.wait_for(
                    tool_fn.ainvoke(pending["tool_args"]),
                    timeout=APPROVAL_TIMEOUT_SECONDS,
                )
                result_str = str(result)[:2000]
                is_error = (
                    "error" in result_str.lower()[:200]
                    or "failed" in result_str.lower()[:200]
                )
            except asyncio.TimeoutError:
                result_str = (
                    f"Tool execution timed out after {APPROVAL_TIMEOUT_SECONDS}s"
                )
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
                    "id": tool_call_id,
                }),
            }

            # Emit receipt
            receipt: dict = {
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

            # ── Persist the tool result as a proper ToolMessage in DB ──
            if tool_call_id:
                await pool.execute(
                    """INSERT INTO chat_messages
                       (session_id, branch_id, role, content,
                        tool_name, metadata)
                       VALUES ($1, $2, 'tool', $3, $4, $5::jsonb)""",
                    uuid.UUID(req.session_id), branch_id,
                    result_str,
                    pending["tool_name"],
                    json.dumps({"tool_call_id": tool_call_id}),
                )

            # ── Re-invoke LLM to reason about tool result ──────────────
            yield {
                "event": "thought",
                "data": json.dumps({"step": "Analyzing result..."}),
            }

            # Rebuild conversation history — now includes the AIMessage
            # with tool_calls AND the ToolMessage we just saved.
            messages = await build_message_history(req.session_id, branch_id)

            connected_providers = await _get_connected_providers()
            active_tools = get_tools_for_context(
                scope=session["scope"],
                focused_tab=session["focused_tab"],
                connected_providers=connected_providers,
            )

            state = AgentState(
                messages=messages,
                focused_tab=session["focused_tab"],
                scope=session["scope"],
                session_id=req.session_id,
                branch_id=branch_id,
                active_tools=active_tools,
                connected_providers=connected_providers,
            )

            graph = get_agent_graph()
            full_response = ""
            post_tool_calls: list[dict] = []
            post_tool_messages: list[dict] = []

            async for stream_mode, stream_data in graph.astream(
                state, stream_mode=["messages", "updates"]
            ):
                # ── Real token streaming from LLM ──
                if stream_mode == "messages":
                    msg_chunk, chunk_meta = stream_data
                    if (
                        chunk_meta.get("langgraph_node") == "llm"
                        and isinstance(msg_chunk, AIMessageChunk)
                    ):
                        # Normalise: Ollama can return list content
                        _c = msg_chunk.content
                        if isinstance(_c, list):
                            _c = "".join(
                                i.get("text", str(i)) if isinstance(i, dict) else str(i)
                                for i in _c
                            )
                        if (
                            _c
                            and not getattr(msg_chunk, "tool_call_chunks", None)
                        ):
                            full_response += _c
                            yield {
                                "event": "token",
                                "data": json.dumps(
                                    {"content": _c}
                                ),
                            }

                # ── Node outputs ──
                elif stream_mode == "updates":
                    for node_name, node_output in stream_data.items():
                        if node_name == "llm":
                            # Emit any thoughts
                            for thought in node_output.get("thoughts", []):
                                yield {
                                    "event": "thought",
                                    "data": json.dumps({"step": thought}),
                                }
                            # Capture tool calls if the LLM decided
                            # to use more tools
                            for msg_obj in node_output.get("messages", []):
                                if (
                                    isinstance(msg_obj, AIMessage)
                                    and msg_obj.tool_calls
                                ):
                                    tc_list = [
                                        {
                                            "id": tc.get("id", ""),
                                            "name": tc["name"],
                                            "args": tc["args"],
                                        }
                                        for tc in msg_obj.tool_calls
                                    ]
                                    post_tool_calls.extend(tc_list)
                                    for tc in msg_obj.tool_calls:
                                        yield {
                                            "event": "tool_use",
                                            "data": json.dumps({
                                                "tool": tc["name"],
                                                "input": tc["args"],
                                                "id": tc.get("id", ""),
                                            }),
                                        }

                        elif node_name == "approval_check":
                            # Handle nested approval-gated tools
                            nested = node_output.get("pending_approval")
                            if nested:
                                tc_json = (
                                    json.dumps(post_tool_calls)
                                    if post_tool_calls else None
                                )
                                await pool.execute(
                                    """INSERT INTO chat_messages
                                       (session_id, branch_id, role, content,
                                        tool_calls, metadata)
                                       VALUES ($1, $2, 'assistant', $3,
                                               $4::jsonb, $5::jsonb)""",
                                    uuid.UUID(req.session_id), branch_id,
                                    full_response or "",
                                    tc_json,
                                    json.dumps({"pending_approval": nested}),
                                )
                                yield {
                                    "event": "approval",
                                    "data": json.dumps({
                                        "action": nested["tool_name"],
                                        "details": nested["tool_args"],
                                    }),
                                }
                                return  # UI will call /approve again

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
                                    post_tool_messages.append({
                                        "tool_name": getattr(m, "name", "unknown"),
                                        "content": m.content[:2000] if m.content else "",
                                        "tool_call_id": getattr(m, "tool_call_id", ""),
                                    })
                            for rcpt in node_output.get("receipts", []):
                                yield {
                                    "event": "receipt",
                                    "data": json.dumps(rcpt),
                                }

            # ── Save the full response ──
            if full_response or post_tool_calls:
                tc_json = (
                    json.dumps(post_tool_calls) if post_tool_calls else None
                )
                msg_row = await pool.fetchrow(
                    """INSERT INTO chat_messages
                       (session_id, branch_id, role, content, tool_calls)
                       VALUES ($1, $2, 'assistant', $3, $4::jsonb)
                       RETURNING id""",
                    uuid.UUID(req.session_id), branch_id,
                    full_response or "", tc_json,
                )
                # Save any tool messages from the post-approval graph run
                for tm in post_tool_messages:
                    await pool.execute(
                        """INSERT INTO chat_messages
                           (session_id, branch_id, role, content,
                            tool_name, metadata)
                           VALUES ($1, $2, 'tool', $3, $4, $5::jsonb)""",
                        uuid.UUID(req.session_id), branch_id,
                        tm["content"], tm["tool_name"],
                        json.dumps({"tool_call_id": tm.get("tool_call_id", "")}),
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

