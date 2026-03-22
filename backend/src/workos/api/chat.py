"""Chat API endpoints with SSE streaming.

Implements a clean SSE protocol for the ReAct loop:

  event: metadata   → {thread_id, run_id}
  event: thinking   → {content}           — reasoning token chunks (collapsible)
  event: text       → {content}           — text token chunks
  event: tool_start → {id, name, args}    — model decided to call a tool
  event: tool_end   → {id, result, error} — tool finished executing
  event: todos      → {todos}             — planning task list update
  event: step       → {step, node}        — ReAct loop iteration boundary
  event: interrupt  → {tool_call_id, …}   — HITL approval needed
  event: error      → {message, …}        — error occurred
  event: end        → {thread_id}         — stream complete

Text and thinking tokens stream in real-time from the "messages" stream mode.
Tool calls, results, and state updates come from the "updates" stream mode.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, ToolMessage
from langchain_ollama import ChatOllama
from langgraph.types import Command

from workos.agent.factory import get_agent
from workos.agent.thinking import ContentType, ThinkingParser
from workos.config import settings
from workos.db.database import get_db
from workos.db.models import ApproveRequest, CancelRequest, ChatRequest

logger = logging.getLogger(__name__)
router = APIRouter(tags=["chat"])

_active_tasks: dict[str, asyncio.Task] = {}


# ---------------------------------------------------------------------------
# SSE helpers
# ---------------------------------------------------------------------------

def _sse(event: str, data: dict | list) -> str:
    """Format a Server-Sent Event line."""
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


# ---------------------------------------------------------------------------
# Stream collector — accumulates parts for message persistence
# ---------------------------------------------------------------------------

class _Collector:
    """Accumulates streaming content blocks for persisting the assistant message."""

    def __init__(self):
        self.parts: list[dict] = []
        self._reasoning: str = ""
        self._text: str = ""

    # --- content accumulators ---

    def add_reasoning(self, content: str):
        if self._text:
            self.parts.append({"type": "text", "content": self._text})
            self._text = ""
        self._reasoning += content

    def add_text(self, content: str):
        if self._reasoning:
            self.parts.append({"type": "reasoning", "content": self._reasoning})
            self._reasoning = ""
        self._text += content

    def add_tool_start(self, tool_id: str, name: str, args: dict):
        self._flush()
        self.parts.append({
            "type": "tool_call", "id": tool_id, "name": name,
            "args": args, "status": "running", "result": None,
        })

    def add_tool_end(self, tool_call_id: str, result: str, *, error: str | None = None):
        for p in self.parts:
            if p.get("type") == "tool_call" and p.get("id") == tool_call_id:
                p["status"] = "error" if error else "success"
                p["result"] = error or result
                break

    def add_todos(self, todos: list[dict]):
        self._flush()
        self.parts.append({"type": "todo", "todos": todos})

    def add_interrupt(self, data: dict):
        self._flush()
        self.parts.append({"type": "interrupt", **data})

    def add_sub_agent_start(self, agent: str, task: str, tool_id: str):
        self._flush()
        self.parts.append({
            "type": "sub_agent", "agent": agent, "task": task,
            "tool_id": tool_id, "status": "running", "result": None,
        })

    def add_sub_agent_end(self, tool_id: str, result: str, *, error: str | None = None):
        for p in self.parts:
            if p.get("type") == "sub_agent" and p.get("tool_id") == tool_id:
                p["status"] = "error" if error else "success"
                p["result"] = error or result
                break

    # --- helpers ---

    def _flush(self):
        if self._reasoning:
            self.parts.append({"type": "reasoning", "content": self._reasoning})
            self._reasoning = ""
        if self._text:
            self.parts.append({"type": "text", "content": self._text})
            self._text = ""

    def finalize(self) -> list[dict]:
        self._flush()
        return [
            p for p in self.parts
            if not (p.get("type") in ("text", "reasoning") and not p.get("content", "").strip())
        ]


# ---------------------------------------------------------------------------
# Settings loader
# ---------------------------------------------------------------------------

async def _load_settings() -> dict:
    db = await get_db()
    cursor = await db.execute("SELECT key, value FROM settings")
    rows = await cursor.fetchall()
    s = {r[0]: r[1] for r in rows}
    return {
        "model": s.get("ollama_model") or settings.ollama_model,
        "ollama_url": s.get("ollama_url") or settings.ollama_url,
        "max_steps": int(s.get("max_steps", str(settings.max_steps))),
        "system_prompt": s.get("system_prompt") or settings.system_prompt,
    }


# ---------------------------------------------------------------------------
# Auto-title (background task)
# ---------------------------------------------------------------------------

async def _auto_title(thread_id: str, user_msg: str, model: str, url: str):
    try:
        from langchain_core.messages import SystemMessage, HumanMessage as HM

        # Explicitly disable thinking for title generation — it must be fast
        llm = ChatOllama(model=model, base_url=url, reasoning=False, num_predict=30)
        resp = await llm.ainvoke([
            SystemMessage(content="Generate a very short title (3-6 words, no quotes) for a conversation starting with:"),
            HM(content=user_msg),
        ])
        title = resp.content.strip().strip('"').strip("'")[:80] if isinstance(resp.content, str) else "New Chat"
        db = await get_db()
        await db.execute("UPDATE threads SET title = ? WHERE id = ?", (title, thread_id))
        await db.commit()
    except Exception:
        logger.warning("Auto-title failed for %s", thread_id, exc_info=True)


# ---------------------------------------------------------------------------
# Core streaming task
# ---------------------------------------------------------------------------

async def _run_stream(
    *,
    graph_input,
    thread_id: str,
    config: dict,
    queue: asyncio.Queue,
    model: str,
    ollama_url: str,
    is_new: bool = False,
    user_msg: str = "",
):
    """Run the ReAct agent and push SSE events into *queue*.

    Uses two LangGraph stream modes simultaneously:
      messages — real-time token-by-token streaming (thinking + text)
      updates  — node completions (tool calls, tool results, interrupts, todos)
    """
    collector = _Collector()
    parser = ThinkingParser(model_name=model)
    step_count = 0
    tool_name_map: dict[str, str] = {}  # track tool names by ID for tool_end events

    try:
        graph = await get_agent()

        # --- metadata ---
        await queue.put(_sse("metadata", {"thread_id": thread_id, "run_id": str(uuid.uuid4())}))

        async for stream_mode, chunk in graph.astream(
            graph_input,
            config=config,
            stream_mode=["messages", "updates"],
        ):
            # ===== MESSAGES MODE: real-time token streaming =====
            if stream_mode == "messages":
                msg_chunk, metadata = chunk
                node = metadata.get("langgraph_node", "")

                # Only process agent node AIMessageChunks for text/thinking
                if node == "agent" and isinstance(msg_chunk, AIMessageChunk):
                    # --- Native reasoning tokens (via ChatOllama reasoning=True) ---
                    # langchain-ollama puts thinking in additional_kwargs["reasoning_content"]
                    reasoning_content = msg_chunk.additional_kwargs.get("reasoning_content")
                    if reasoning_content:
                        await queue.put(_sse("thinking", {"content": reasoning_content}))
                        collector.add_reasoning(reasoning_content)

                    # --- Text content (may contain <think> tags as fallback) ---
                    # Skip <think> tag parsing if native reasoning was already emitted
                    # to avoid sending duplicate thinking tokens
                    content = msg_chunk.content
                    if content:
                        text = content if isinstance(content, str) else str(content)
                        if reasoning_content:
                            # Native reasoning present — treat all content as text (no <think> parsing)
                            await queue.put(_sse("text", {"content": text}))
                            collector.add_text(text)
                        else:
                            blocks = parser.feed(text)
                            for block in blocks:
                                if block.type == ContentType.REASONING:
                                    await queue.put(_sse("thinking", {"content": block.content}))
                                    collector.add_reasoning(block.content)
                                else:
                                    await queue.put(_sse("text", {"content": block.content}))
                                    collector.add_text(block.content)

            # ===== UPDATES MODE: node completions =====
            elif stream_mode == "updates":
                if not isinstance(chunk, dict):
                    continue

                # --- HITL interrupts ---
                if "__interrupt__" in chunk:
                    for itr in chunk["__interrupt__"]:
                        value = (
                            itr.value
                            if hasattr(itr, "value")
                            else (itr.get("value", {}) if isinstance(itr, dict) else {})
                        )
                        await queue.put(_sse("interrupt", value))
                        collector.add_interrupt(value)
                    continue

                for node_name, node_output in chunk.items():
                    if not isinstance(node_output, dict):
                        continue

                    # --- Agent node completed → extract tool calls ---
                    if node_name == "agent":
                        step_count += 1
                        await queue.put(_sse("step", {"step": step_count, "node": "agent"}))

                        for msg in node_output.get("messages", []):
                            if isinstance(msg, AIMessage) and msg.tool_calls:
                                for tc in msg.tool_calls:
                                    tool_name_map[tc["id"]] = tc["name"]
                                    tc_name = tc["name"]

                                    # Detect delegation tools → emit sub_agent events
                                    if tc_name.startswith("delegate_to_"):
                                        agent_name = tc_name.replace("delegate_to_", "")
                                        task = tc["args"].get("request", "")
                                        await queue.put(_sse("sub_agent_start", {
                                            "agent": agent_name,
                                            "task": task,
                                            "tool_id": tc["id"],
                                        }))
                                        collector.add_sub_agent_start(agent_name, task, tc["id"])
                                    else:
                                        await queue.put(_sse("tool_start", {
                                            "id": tc["id"],
                                            "name": tc_name,
                                            "args": tc["args"],
                                        }))
                                        collector.add_tool_start(tc["id"], tc_name, tc["args"])

                    # --- Tools node completed → extract results + todos ---
                    elif node_name == "tools":
                        for msg in node_output.get("messages", []):
                            if isinstance(msg, ToolMessage):
                                is_err = msg.content.startswith("Error:")
                                resolved_name = tool_name_map.get(msg.tool_call_id, getattr(msg, "name", ""))

                                # Detect delegation tool results → emit sub_agent_end
                                if resolved_name.startswith("delegate_to_"):
                                    agent_name = resolved_name.replace("delegate_to_", "")
                                    await queue.put(_sse("sub_agent_end", {
                                        "agent": agent_name,
                                        "tool_id": msg.tool_call_id,
                                        "result": msg.content,
                                        **({"error": msg.content} if is_err else {}),
                                    }))
                                    if is_err:
                                        collector.add_sub_agent_end(msg.tool_call_id, "", error=msg.content)
                                    else:
                                        collector.add_sub_agent_end(msg.tool_call_id, msg.content)
                                else:
                                    event_data: dict = {
                                        "id": msg.tool_call_id,
                                        "name": resolved_name,
                                        "result": msg.content,
                                    }
                                    if is_err:
                                        event_data["error"] = msg.content
                                    await queue.put(_sse("tool_end", event_data))

                                    if is_err:
                                        collector.add_tool_end(msg.tool_call_id, "", error=msg.content)
                                    else:
                                        collector.add_tool_end(msg.tool_call_id, msg.content)

                        # Todo state updates
                        todos = node_output.get("todos")
                        if todos is not None:
                            await queue.put(_sse("todos", {"todos": todos}))
                            collector.add_todos(todos)

        # --- flush remaining thinking buffer ---
        for block in parser.flush():
            if block.type == ContentType.REASONING:
                await queue.put(_sse("thinking", {"content": block.content}))
                collector.add_reasoning(block.content)
            else:
                await queue.put(_sse("text", {"content": block.content}))
                collector.add_text(block.content)

    except asyncio.CancelledError:
        logger.info("Stream cancelled for thread %s", thread_id)
    except Exception as e:
        logger.exception("Stream error for thread %s", thread_id)
        err_msg = str(e)
        recoverable = True
        # Friendlier messages for common failures
        err_lower = err_msg.lower()
        if "connection" in err_lower and ("refused" in err_lower or "error" in err_lower):
            err_msg = f"Cannot connect to Ollama at {ollama_url}. Is Ollama running?"
        elif "404" in err_msg or "model" in err_lower and "not found" in err_lower:
            err_msg = f"Model '{model}' not found. Please pull it with: ollama pull {model}"
        elif "timeout" in err_lower:
            err_msg = "Request timed out. The model may be loading or the server is overloaded."
        await queue.put(_sse("error", {"message": err_msg, "recoverable": recoverable}))
    finally:
        # --- persist assistant message ---
        parts = collector.finalize()
        if parts:
            db = await get_db()
            await db.execute(
                "INSERT INTO messages (id, thread_id, role, parts) VALUES (?, ?, 'assistant', ?)",
                (str(uuid.uuid4()), thread_id, json.dumps(parts)),
            )
            await db.execute(
                "UPDATE threads SET updated_at = datetime('now') WHERE id = ?",
                (thread_id,),
            )
            await db.commit()

        if is_new and model and user_msg:
            asyncio.create_task(_auto_title(thread_id, user_msg, model, ollama_url))

        await queue.put(_sse("end", {"thread_id": thread_id}))
        await queue.put(None)  # sentinel
        _active_tasks.pop(thread_id, None)


# ---------------------------------------------------------------------------
# SSE response factory
# ---------------------------------------------------------------------------

def _sse_response(queue: asyncio.Queue, thread_id: str) -> StreamingResponse:
    async def generate():
        try:
            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield msg
        except asyncio.CancelledError:
            pass
        finally:
            # Cancel the streaming task when client disconnects
            task = _active_tasks.get(thread_id)
            if task and not task.done():
                task.cancel()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Thread-Id": thread_id,
        },
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream a ReAct agent response via SSE."""
    db = await get_db()

    # Create thread if needed
    thread_id = req.thread_id
    is_new = not thread_id
    if not thread_id:
        thread_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO threads (id, title) VALUES (?, ?)",
            (thread_id, req.message[:50] if req.message else "New Chat"),
        )
        await db.commit()

    # Persist user message
    await db.execute(
        "INSERT INTO messages (id, thread_id, role, parts) VALUES (?, ?, 'user', ?)",
        (str(uuid.uuid4()), thread_id, json.dumps([{"type": "text", "content": req.message}])),
    )
    await db.commit()

    eff = await _load_settings()
    model = req.model or eff["model"]

    config = {
        "configurable": {
            "thread_id": thread_id,
            "model": model,
            "ollama_url": eff["ollama_url"],
            "system_prompt": eff["system_prompt"],
        },
        "recursion_limit": eff["max_steps"] * 2 + 1,
    }

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    task = asyncio.create_task(
        _run_stream(
            graph_input={"messages": [HumanMessage(content=req.message)]},
            thread_id=thread_id,
            config=config,
            queue=queue,
            model=model,
            ollama_url=eff["ollama_url"],
            is_new=is_new,
            user_msg=req.message,
        )
    )
    _active_tasks[thread_id] = task
    return _sse_response(queue, thread_id)


@router.post("/chat/cancel")
async def cancel_chat(req: CancelRequest):
    """Cancel a running agent stream."""
    task = _active_tasks.get(req.thread_id)
    if task and not task.done():
        task.cancel()
        return {"status": "cancelling", "thread_id": req.thread_id}
    return {"status": "not_found", "thread_id": req.thread_id}


@router.post("/chat/approve")
async def approve_tool(req: ApproveRequest):
    """Resume a paused agent after HITL tool approval."""
    eff = await _load_settings()
    model = eff["model"]

    config = {
        "configurable": {
            "thread_id": req.thread_id,
            "model": model,
            "ollama_url": eff["ollama_url"],
            "system_prompt": eff["system_prompt"],
        },
        "recursion_limit": eff["max_steps"] * 2 + 1,
    }

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    task = asyncio.create_task(
        _run_stream(
            graph_input=Command(resume={"decision": req.decision}),
            thread_id=req.thread_id,
            config=config,
            queue=queue,
            model=model,
            ollama_url=eff["ollama_url"],
        )
    )
    _active_tasks[req.thread_id] = task
    return _sse_response(queue, req.thread_id)
