"""
Shared helpers for AI routers — message history reconstruction, JSONB parsing.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, AIMessage, ToolMessage

from db.connection import get_pool

log = logging.getLogger(__name__)


def parse_jsonb(val: Any) -> list | dict:
    """Safely parse JSONB — asyncpg may return dict/list or str."""
    if val is None:
        return []
    if isinstance(val, (dict, list)):
        return val
    return json.loads(val)


def safe_jsonb(val: Any, default: Any = None) -> Any:
    """Safely convert JSONB value — asyncpg may return parsed or string."""
    if val is None:
        return default if default is not None else []
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return default if default is not None else []


async def build_message_history(session_id: str, branch_id: int) -> list:
    """
    Reconstruct LangChain message history from the DB for a given session/branch.
    Returns a list of HumanMessage, AIMessage, and ToolMessage objects.
    """
    import uuid

    pool = get_pool()
    msg_rows = await pool.fetch(
        """SELECT role, content, tool_calls, tool_name, tool_result, metadata
           FROM chat_messages
           WHERE session_id = $1 AND branch_id = $2
           ORDER BY created_at""",
        uuid.UUID(session_id), branch_id,
    )

    messages = []
    last_ai_tool_calls: list[dict] = []

    for row in msg_rows:
        if row["role"] == "user":
            messages.append(HumanMessage(content=row["content"]))
        elif row["role"] == "assistant":
            tc_json = parse_jsonb(row["tool_calls"]) if row["tool_calls"] else []
            if tc_json:
                last_ai_tool_calls = tc_json
                messages.append(AIMessage(
                    content=row["content"] or "",
                    tool_calls=[{
                        "id": tc.get("id", ""),
                        "name": tc.get("name", ""),
                        "args": tc.get("args", {}),
                    } for tc in tc_json],
                ))
            else:
                last_ai_tool_calls = []
                messages.append(AIMessage(content=row["content"]))
        elif row["role"] == "tool":
            raw_meta = row.get("metadata")
            meta = parse_jsonb(raw_meta) if raw_meta else {}
            if isinstance(meta, list):
                meta = {}
            tool_call_id = meta.get("tool_call_id") or ""
            tool_name = row.get("tool_name") or "unknown"

            # If metadata didn't have it, look up from the preceding AIMessage
            if not tool_call_id and last_ai_tool_calls:
                for tc in last_ai_tool_calls:
                    if tc.get("name") == tool_name and tc.get("id"):
                        tool_call_id = tc["id"]
                        break

            # Skip orphaned tool messages that would crash OpenAI
            if not tool_call_id:
                log.warning(
                    "Dropping orphan tool message '%s' — no matching tool_call_id",
                    tool_name,
                )
                continue

            messages.append(ToolMessage(
                content=row["content"],
                tool_call_id=tool_call_id,
                name=tool_name,
            ))

    # ── Repair pass: inject synthetic ToolMessages where AIMessage has ──
    # tool_calls but no matching ToolMessage follows.  This prevents
    # OpenAI from rejecting the conversation with
    # "Expected a ToolMessage after AIMessage with tool_calls".
    repaired: list = []
    for i, msg in enumerate(messages):
        repaired.append(msg)
        if isinstance(msg, AIMessage) and getattr(msg, "tool_calls", None):
            needed_ids = {
                tc["id"] for tc in msg.tool_calls if tc.get("id")
            }
            # Scan forward for ToolMessages that satisfy these IDs
            for j in range(i + 1, len(messages)):
                if isinstance(messages[j], ToolMessage):
                    needed_ids.discard(messages[j].tool_call_id)
                else:
                    break  # Non-tool message → stop scanning
            # Inject placeholders for any IDs still unsatisfied
            for tc in msg.tool_calls:
                if tc.get("id") in needed_ids:
                    repaired.append(ToolMessage(
                        content="[Action was not completed]",
                        tool_call_id=tc["id"],
                        name=tc.get("name", "unknown"),
                    ))
    return repaired
