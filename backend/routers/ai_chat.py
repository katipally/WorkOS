"""
AI Chat SSE Streaming Router — handles the core chat streaming endpoint.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import AIMessage, AIMessageChunk, SystemMessage, HumanMessage

from db.connection import get_pool
from schemas.ai import ChatRequest, StopRequest
from services.chat_helpers import build_message_history
from services.agent.graph import get_agent_graph
from services.agent.state import AgentState
from services.agent.config import MAX_STREAM_ITERATIONS, AUTO_TITLE_MAX_LENGTH
from services.ai_service import get_llm

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ai", tags=["ai"])

# Track active generation tasks for cancellation (guarded by _gen_lock)
_active_generations: dict[str, asyncio.Event] = {}
_gen_lock = asyncio.Lock()


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
            messages = await build_message_history(session_id, req.branch_id)

            # Build agent state with scope-filtered tools
            from services.agent.tools import get_tools_for_context, _get_connected_providers

            connected_providers = await _get_connected_providers()

            active_tools = get_tools_for_context(
                scope=req.scope,
                focused_tab=req.focused_tab,
                context_mentions=req.context_mentions or None,
                connected_providers=connected_providers,
            )

            # Inform user which integrations are available / disconnected
            all_integrations = {"slack", "github"}
            disconnected = all_integrations - connected_providers
            if disconnected:
                dc_str = ", ".join(sorted(disconnected))
                yield {
                    "event": "thought",
                    "data": json.dumps({
                        "step": f"Integrations not connected: {dc_str} — those tools are unavailable",
                    }),
                }

            state = AgentState(
                messages=messages,
                focused_tab=req.focused_tab,
                scope=req.scope,
                session_id=session_id,
                branch_id=req.branch_id,
                context_mentions=req.context_mentions,
                active_tools=active_tools,
                connected_providers=connected_providers,
                selected_repo=req.selected_repo or "",
                selected_channel=req.selected_channel or "",
                selected_channel_name=req.selected_channel_name or "",
                uploaded_file_ids=req.uploaded_file_ids or [],
            )

            # Only emit context thought when actively scoped or using mentions
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

            # Run the agent graph with REAL token streaming
            graph = get_agent_graph()

            full_response = ""
            emitted_plan_ids: dict[str, int] = {}
            loop_count = 0
            last_tool_calls_json: str | None = None
            all_tool_calls: list[dict] = []
            tool_messages_to_save: list[dict] = []
            needs_separator = False

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
                    if (
                        metadata.get("langgraph_node") == "llm"
                        and isinstance(msg_chunk, AIMessageChunk)
                    ):
                        # ── Reasoning / chain-of-thought tokens ──────
                        reasoning_text = (
                            getattr(msg_chunk, "reasoning_content", None)
                            or (msg_chunk.additional_kwargs or {}).get("reasoning_content")
                            or (msg_chunk.additional_kwargs or {}).get("reasoning")
                        )
                        if reasoning_text:
                            yield {
                                "event": "thought",
                                "data": json.dumps({"step": reasoning_text}),
                            }

                        # ── Regular content tokens ───────────────────
                        chunk_content = msg_chunk.content
                        # Normalise: Ollama can send content as a list
                        if isinstance(chunk_content, list):
                            chunk_content = "".join(
                                item.get("text", str(item)) if isinstance(item, dict) else str(item)
                                for item in chunk_content
                            )
                        if (
                            chunk_content
                            and not getattr(msg_chunk, "tool_call_chunks", None)
                        ):
                            if needs_separator and full_response:
                                full_response += "\n\n"
                                yield {
                                    "event": "token",
                                    "data": json.dumps({"content": "\n\n"}),
                                }
                                needs_separator = False
                            full_response += chunk_content
                            yield {
                                "event": "token",
                                "data": json.dumps({"content": chunk_content}),
                            }

                # ── Node-level outputs ────────────────────────────────
                elif stream_mode == "updates":
                    loop_count += 1
                    if loop_count > MAX_STREAM_ITERATIONS:
                        yield {
                            "event": "error",
                            "data": json.dumps({"message": "Agent reached maximum iteration limit"}),
                        }
                        break

                    for node_name, node_output in stream_data.items():
                        if node_name == "rag_retrieval":
                            ctx = node_output.get("rag_context") or []
                            if ctx:
                                avg_score = sum(
                                    c.get("rerank_score", c.get("score", 0)) for c in ctx
                                ) / len(ctx)
                                yield {
                                    "event": "thought",
                                    "data": json.dumps({
                                        "step": f"Found {len(ctx)} relevant context items (avg relevance {avg_score:.0%})",
                                    }),
                                }

                        elif node_name == "llm":
                            new_messages = node_output.get("messages", [])

                            for thought in node_output.get("thoughts", []):
                                yield {
                                    "event": "thought",
                                    "data": json.dumps({"step": thought}),
                                }

                            plan_steps = node_output.get("plan_steps", [])
                            for ps in plan_steps:
                                emitted_plan_ids[ps.get("tool", "")] = ps["id"]
                                yield {
                                    "event": "plan_step",
                                    "data": json.dumps(ps),
                                }

                            for msg in new_messages:
                                if isinstance(msg, AIMessage):
                                    if msg.tool_calls:
                                        tc_list = [
                                            {"id": tc.get("id", ""), "name": tc["name"], "args": tc["args"]}
                                            for tc in msg.tool_calls
                                        ]
                                        last_tool_calls_json = json.dumps(tc_list)
                                        all_tool_calls.extend(tc_list)
                                        for tc in msg.tool_calls:
                                            yield {
                                                "event": "tool_use",
                                                "data": json.dumps({
                                                    "tool": tc["name"],
                                                    "input": tc["args"],
                                                    "id": tc.get("id", ""),
                                                }),
                                            }
                                    # Note: Do NOT re-append msg.content here.
                                    # Content is already captured token-by-token
                                    # via the "messages" stream mode above.

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
                                # Always save the assistant message with tool_calls
                                # + approval metadata — even when full_response is
                                # empty (the LLM often calls tools without preceding
                                # text).  Without this the /approve endpoint cannot
                                # find the pending_approval → 400.
                                all_tc_json = json.dumps(all_tool_calls) if all_tool_calls else None
                                await pool.execute(
                                    """INSERT INTO chat_messages
                                       (session_id, branch_id, role, content,
                                        tool_calls, metadata)
                                       VALUES ($1, $2, 'assistant', $3,
                                               $4::jsonb, $5::jsonb)""",
                                    uuid.UUID(session_id), req.branch_id,
                                    full_response or "",
                                    all_tc_json,
                                    json.dumps({"pending_approval": pending}),
                                )
                                return

                        elif node_name == "tools":
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
                                    tool_messages_to_save.append({
                                        "tool_name": tool_name,
                                        "content": tool_content,
                                        "tool_call_id": tool_call_id,
                                    })
                                    plan_id = emitted_plan_ids.get(tool_name)
                                    if plan_id is not None:
                                        yield {
                                            "event": "plan_step",
                                            "data": json.dumps({"id": plan_id, "status": "done"}),
                                        }

                            receipts = node_output.get("receipts", [])
                            for rcpt in receipts:
                                yield {
                                    "event": "receipt",
                                    "data": json.dumps(rcpt),
                                }

                            action_cards = node_output.get("action_cards", [])
                            for ac in action_cards:
                                yield {
                                    "event": "action_card",
                                    "data": json.dumps(ac),
                                }

                            needs_separator = True

            # Save assistant response (with tool_calls if any)
            if full_response or last_tool_calls_json:
                all_tool_calls_json = json.dumps(all_tool_calls) if all_tool_calls else last_tool_calls_json
                msg_row = await pool.fetchrow(
                    """INSERT INTO chat_messages (session_id, branch_id, role, content, tool_calls)
                       VALUES ($1, $2, 'assistant', $3, $4::jsonb) RETURNING id""",
                    uuid.UUID(session_id), req.branch_id,
                    full_response or "",
                    all_tool_calls_json,
                )

                # Save tool result messages with tool_call_id in metadata
                for tm in tool_messages_to_save:
                    await pool.execute(
                        """INSERT INTO chat_messages
                           (session_id, branch_id, role, content, tool_name, metadata)
                           VALUES ($1, $2, 'tool', $3, $4, $5::jsonb)""",
                        uuid.UUID(session_id), req.branch_id,
                        tm["content"], tm["tool_name"],
                        json.dumps({"tool_call_id": tm.get("tool_call_id", "")}),
                    )

                # Auto-title the session if it's the first exchange
                msg_count = await pool.fetchval(
                    "SELECT COUNT(*) FROM chat_messages WHERE session_id = $1",
                    uuid.UUID(session_id),
                )
                if msg_count <= 3:
                    try:
                        title_llm = await get_llm("ai", streaming=False, temperature=0.3)
                        snippet = req.message[:300]
                        reply_snippet = (full_response or "")[:200]
                        title_resp = await title_llm.ainvoke([
                            SystemMessage(content=(
                                "Generate a short, descriptive title (max 8 words) for this chat conversation. "
                                "Return ONLY the title text, no quotes, no punctuation at the end."
                            )),
                            HumanMessage(content=f"User: {snippet}\nAssistant: {reply_snippet}"),
                        ])
                        raw_title = title_resp.content or ""
                        # Normalise: Ollama may return content as a list
                        if isinstance(raw_title, list):
                            raw_title = " ".join(
                                item.get("text", str(item)) if isinstance(item, dict) else str(item)
                                for item in raw_title
                            )
                        title = raw_title.strip().strip('"').strip("'")[:AUTO_TITLE_MAX_LENGTH]
                        if not title:
                            title = req.message[:50].strip() + ("..." if len(req.message) > 50 else "")
                    except Exception:
                        title = req.message[:50].strip() + ("..." if len(req.message) > 50 else "")

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


@router.post("/stop")
async def stop_generation(req: StopRequest):
    """Stop the current generation for a session."""
    async with _gen_lock:
        cancel_event = _active_generations.get(req.session_id)
    if cancel_event:
        cancel_event.set()
        return {"ok": True}
    return {"ok": False, "message": "No active generation found"}
