"""
Slack agent tools — LangChain @tool definitions for Slack read/write operations.
"""

from __future__ import annotations

import json
import time
import logging
from typing import Optional

from langchain_core.tools import tool

from db.connection import get_pool

log = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# SLACK — READ
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def slack_list_channels() -> str:
    """List all synced Slack channels with their names and IDs.
    Returns channel_id and channel_name for each channel."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT channel_id, channel_name, is_private, num_members, topic "
        "FROM slack_channels ORDER BY channel_name"
    )
    if not rows:
        return "No Slack channels synced yet. The user should connect Slack in Settings first, then sync channels."
    channels = [
        {
            "id": r["channel_id"],
            "name": r["channel_name"],
            "private": r["is_private"],
            "members": r["num_members"],
            "topic": r["topic"][:100] if r["topic"] else "",
        }
        for r in rows
    ]
    return json.dumps(channels, indent=2)


@tool
async def slack_list_users() -> str:
    """List all synced Slack workspace members."""
    pool = get_pool()
    rows = await pool.fetch(
        "SELECT user_id, name, display_name, is_bot FROM slack_users ORDER BY name"
    )
    if not rows:
        return "No Slack users synced yet."
    users = [
        {"id": r["user_id"], "name": r["name"], "display_name": r["display_name"], "is_bot": r["is_bot"]}
        for r in rows
    ]
    return json.dumps(users, indent=2)


@tool
async def slack_get_channel_messages(channel_id: str, hours: int = 24, limit: int = 50) -> str:
    """Fetch recent messages from a Slack channel.
    channel_id: The Slack channel ID (e.g. C0123456789).
    hours: How many hours back to fetch (default 24, 0 for all).
    limit: Max messages to return (default 50, max 200)."""
    try:
        from services.slack_client import _slack

        params: dict = {"channel": channel_id, "limit": min(limit, 200)}
        if hours > 0:
            params["oldest"] = str(time.time() - hours * 3600)
        data = await _slack("conversations.history", params=params)
        messages = data.get("messages", [])
        results = []
        for m in reversed(messages):
            if m.get("subtype") in ("channel_join", "channel_leave"):
                continue
            results.append({
                "ts": m["ts"],
                "user": m.get("user", m.get("username", "bot")),
                "text": m.get("text", "")[:500],
                "reply_count": m.get("reply_count", 0),
                "thread_ts": m.get("thread_ts"),
            })
        if not results:
            return f"No messages found in channel {channel_id} in the last {hours} hours."
        return json.dumps(results[:limit], indent=2)
    except Exception as e:
        return f"Failed to fetch channel messages: {e}"


@tool
async def slack_get_thread(channel_id: str, thread_ts: str) -> str:
    """Fetch all replies in a specific Slack thread.
    channel_id: The channel containing the thread.
    thread_ts: The timestamp of the parent message."""
    try:
        from services.slack_client import _slack

        data = await _slack(
            "conversations.replies",
            params={"channel": channel_id, "ts": thread_ts, "limit": 100},
        )
        msgs = data.get("messages", [])
        results = [
            {"ts": m["ts"], "user": m.get("user", "bot"), "text": m.get("text", "")[:500]}
            for m in msgs
        ]
        return json.dumps(results, indent=2)
    except Exception as e:
        return f"Failed to fetch thread: {e}"


@tool
async def slack_search_messages(query: str, channel_name: Optional[str] = None) -> str:
    """Search Slack messages across channels by keyword using the live Slack API.
    query: The search term.
    channel_name: Optional channel name to restrict search (without #)."""
    try:
        from services.slack_client import _slack

        search_q = f"in:#{channel_name} {query}" if channel_name else query
        data = await _slack("search.messages", params={"query": search_q, "count": 20, "sort": "timestamp"})
        matches = data.get("messages", {}).get("matches", [])
        if not matches:
            return f"No Slack messages found matching '{query}'."
        results = [
            {
                "channel": m.get("channel", {}).get("name", ""),
                "user": m.get("username", m.get("user", "")),
                "text": m.get("text", "")[:500],
                "ts": m["ts"],
                "permalink": m.get("permalink", ""),
            }
            for m in matches
        ]
        return json.dumps(results, indent=2)
    except Exception as e:
        return f"Failed to search Slack messages: {e}"


@tool
async def slack_get_channel_info(channel_id: str) -> str:
    """Get detailed info for a specific Slack channel including topic, purpose, member count."""
    try:
        from services.slack_client import _slack

        data = await _slack("conversations.info", params={"channel": channel_id, "include_num_members": "true"})
        c = data.get("channel", {})
        info = {
            "id": c["id"],
            "name": c.get("name", ""),
            "topic": c.get("topic", {}).get("value", ""),
            "purpose": c.get("purpose", {}).get("value", ""),
            "num_members": c.get("num_members", 0),
            "is_private": c.get("is_private", False),
        }
        return json.dumps(info, indent=2)
    except Exception as e:
        return f"Failed to get channel info: {e}"


@tool
async def slack_get_pins(channel_id: str) -> str:
    """List pinned messages in a Slack channel."""
    try:
        from services.slack_client import _slack

        data = await _slack("pins.list", params={"channel": channel_id})
        items = data.get("items", [])
        pins = [
            {
                "ts": i.get("message", {}).get("ts", ""),
                "user": i.get("message", {}).get("user", ""),
                "text": i.get("message", {}).get("text", "")[:500],
            }
            for i in items
            if i.get("type") == "message"
        ]
        return json.dumps(pins, indent=2) if pins else "No pinned messages in this channel."
    except Exception as e:
        return f"Failed to get pins: {e}"


@tool
async def slack_get_user_presence(user_id: str) -> str:
    """Check if a Slack user is currently online."""
    try:
        from services.slack_client import _slack

        data = await _slack("users.getPresence", params={"user": user_id})
        return json.dumps({
            "user_id": user_id,
            "presence": data.get("presence", "unknown"),
            "online": data.get("online", False),
        })
    except Exception as e:
        return f"Failed to get user presence: {e}"


@tool
async def slack_list_files(channel_id: Optional[str] = None, count: int = 20) -> str:
    """List files shared in Slack. Optionally filter by channel_id."""
    try:
        from services.slack_client import _slack

        params: dict = {"count": min(count, 100)}
        if channel_id:
            params["channel"] = channel_id
        data = await _slack("files.list", params=params)
        files = [
            {
                "id": f["id"],
                "name": f.get("name", ""),
                "filetype": f.get("filetype", ""),
                "size": f.get("size", 0),
                "user": f.get("user", ""),
                "permalink": f.get("permalink", ""),
            }
            for f in data.get("files", [])
        ]
        return json.dumps(files, indent=2) if files else "No files found."
    except Exception as e:
        return f"Failed to list files: {e}"


# ═══════════════════════════════════════════════════════════════════════════════
# SLACK — WRITE (these require approval)
# ═══════════════════════════════════════════════════════════════════════════════

@tool
async def slack_send_message(channel_id: str, text: str, thread_ts: Optional[str] = None) -> str:
    """Send a message to a Slack channel. Optionally reply in a thread.
    channel_id: Target channel ID.
    text: Message text to send.
    thread_ts: If replying to a thread, the parent message timestamp."""
    try:
        from services.slack_client import _slack

        payload: dict = {"channel": channel_id, "text": text}
        if thread_ts:
            payload["thread_ts"] = thread_ts
        data = await _slack("chat.postMessage", json_body=payload)
        return f"Message sent successfully (ts={data.get('ts', '')})."
    except Exception as e:
        return f"Failed to send Slack message: {e}"


@tool
async def slack_send_dm(user_id: str, text: str) -> str:
    """Send a direct message to a Slack user.
    user_id: The Slack user ID to message.
    text: Message text to send."""
    try:
        from services.slack_client import _slack

        open_data = await _slack("conversations.open", json_body={"users": user_id})
        channel_id = open_data["channel"]["id"]
        data = await _slack("chat.postMessage", json_body={"channel": channel_id, "text": text})
        return f"DM sent successfully to {user_id} (ts={data.get('ts', '')})."
    except Exception as e:
        return f"Failed to send DM: {e}"


@tool
async def slack_add_reaction(channel_id: str, timestamp: str, emoji: str) -> str:
    """Add an emoji reaction to a Slack message.
    emoji: The emoji name without colons (e.g. 'thumbsup')."""
    try:
        from services.slack_client import _slack

        await _slack("reactions.add", json_body={
            "channel": channel_id, "timestamp": timestamp, "name": emoji.strip(":"),
        })
        return f"Added :{emoji.strip(':')}:  reaction."
    except Exception as e:
        return f"Failed to add reaction: {e}"


@tool
async def slack_pin_message(channel_id: str, timestamp: str) -> str:
    """Pin a message in a Slack channel."""
    try:
        from services.slack_client import _slack

        await _slack("pins.add", json_body={"channel": channel_id, "timestamp": timestamp})
        return "Message pinned successfully."
    except Exception as e:
        return f"Failed to pin message: {e}"


@tool
async def slack_schedule_message(channel_id: str, text: str, post_at: int) -> str:
    """Schedule a message to be sent later.
    post_at: Unix timestamp for when the message should be sent."""
    try:
        from services.slack_client import _slack

        data = await _slack("chat.scheduleMessage", json_body={
            "channel": channel_id, "text": text, "post_at": post_at,
        })
        return f"Message scheduled (id={data.get('scheduled_message_id', '')})."
    except Exception as e:
        return f"Failed to schedule message: {e}"


@tool
async def slack_edit_message(channel_id: str, ts: str, text: str) -> str:
    """Edit an existing Slack message.
    ts: The timestamp of the message to edit.
    text: The new message text."""
    try:
        from services.slack_client import _slack

        await _slack("chat.update", json_body={"channel": channel_id, "ts": ts, "text": text})
        return "Message edited successfully."
    except Exception as e:
        return f"Failed to edit message: {e}"


@tool
async def slack_delete_message(channel_id: str, ts: str) -> str:
    """Delete a Slack message.
    ts: The timestamp of the message to delete."""
    try:
        from services.slack_client import _slack

        await _slack("chat.delete", json_body={"channel": channel_id, "ts": ts})
        return "Message deleted successfully."
    except Exception as e:
        return f"Failed to delete message: {e}"


# ─── Export list ──────────────────────────────────────────────────────────────

SLACK_READ_TOOLS = [
    slack_list_channels,
    slack_list_users,
    slack_get_channel_messages,
    slack_get_thread,
    slack_search_messages,
    slack_get_channel_info,
    slack_get_pins,
    slack_get_user_presence,
    slack_list_files,
]

SLACK_WRITE_TOOLS = [
    slack_send_message,
    slack_send_dm,
    slack_add_reaction,
    slack_pin_message,
    slack_schedule_message,
    slack_edit_message,
    slack_delete_message,
]

SLACK_TOOLS = SLACK_READ_TOOLS + SLACK_WRITE_TOOLS
