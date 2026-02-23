"""
Slack write tools — post messages, DMs, reactions, pins, reminders, bookmarks, edit/delete.
"""

from __future__ import annotations

from services.slack_client import _slack
from tools import tool
from tools.slack.models import (
    AddBookmarkInput,
    AddReminderInput,
    DeleteMessageInput,
    DMInput,
    EditMessageInput,
    PinInput,
    PostMessageInput,
    ReactionInput,
    RemoveReactionInput,
    ScheduleMessageInput,
    SlackBookmark,
    SlackOkResult,
    SlackPostResult,
    SlackReminder,
    SlackScheduledMessage,
    UnpinInput,
)
from tools.slack.sync import _slack_exc


# ── post message ──────────────────────────────────────────────────────────

@tool(
    name="slack_post_message",
    description="Post a message to a Slack channel (optionally in a thread)",
    integration="slack",
    method="POST",
    path="/messages",
    idempotent=False,
)
async def slack_post_message(inp: PostMessageInput) -> SlackPostResult:
    try:
        payload: dict = {"channel": inp.channel_id, "text": inp.text}
        if inp.thread_ts:
            payload["thread_ts"] = inp.thread_ts
        data = await _slack("chat.postMessage", json_body=payload)
        return SlackPostResult(ts=data.get("ts"), channel=data.get("channel"))
    except Exception as e:
        raise _slack_exc(e)


# ── send DM ───────────────────────────────────────────────────────────────

@tool(
    name="slack_send_dm",
    description="Send a direct message to a Slack user",
    integration="slack",
    method="POST",
    path="/dm",
    idempotent=False,
)
async def slack_send_dm(inp: DMInput) -> SlackPostResult:
    try:
        open_data = await _slack("conversations.open", json_body={"users": inp.user_id})
        channel_id = open_data["channel"]["id"]
        data = await _slack("chat.postMessage", json_body={"channel": channel_id, "text": inp.text})
        return SlackPostResult(ts=data.get("ts"), channel=channel_id)
    except Exception as e:
        raise _slack_exc(e)


# ── add reaction ──────────────────────────────────────────────────────────

@tool(
    name="slack_add_reaction",
    description="Add an emoji reaction to a Slack message",
    integration="slack",
    method="POST",
    path="/reactions",
    idempotent=False,
)
async def slack_add_reaction(inp: ReactionInput) -> SlackOkResult:
    try:
        await _slack(
            "reactions.add",
            json_body={
                "channel": inp.channel_id,
                "timestamp": inp.timestamp,
                "name": inp.emoji.strip(":"),
            },
        )
        return SlackOkResult(ok=True, emoji=inp.emoji, ts=inp.timestamp)
    except Exception as e:
        raise _slack_exc(e)


# ── pin message ───────────────────────────────────────────────────────────

@tool(
    name="slack_pin_message",
    description="Pin a message in a Slack channel",
    integration="slack",
    method="POST",
    path="/pins",
    idempotent=False,
)
async def slack_pin_message(inp: PinInput) -> SlackOkResult:
    try:
        await _slack("pins.add", json_body={"channel": inp.channel_id, "timestamp": inp.timestamp})
        return SlackOkResult(ok=True, pinned_ts=inp.timestamp)
    except Exception as e:
        raise _slack_exc(e)


# ── unpin message ─────────────────────────────────────────────────────────

@tool(
    name="slack_unpin_message",
    description="Unpin a message in a Slack channel",
    integration="slack",
    method="DELETE",
    path="/pins",
    idempotent=False,
)
async def slack_unpin_message(inp: UnpinInput) -> SlackOkResult:
    try:
        await _slack("pins.remove", json_body={"channel": inp.channel_id, "timestamp": inp.timestamp})
        return SlackOkResult(ok=True)
    except Exception as e:
        raise _slack_exc(e)


# ── remove reaction ──────────────────────────────────────────────────────

@tool(
    name="slack_remove_reaction",
    description="Remove an emoji reaction from a Slack message",
    integration="slack",
    method="DELETE",
    path="/reactions",
    idempotent=False,
)
async def slack_remove_reaction(inp: RemoveReactionInput) -> SlackOkResult:
    try:
        await _slack(
            "reactions.remove",
            json_body={
                "channel": inp.channel_id,
                "timestamp": inp.timestamp,
                "name": inp.emoji.strip(":"),
            },
        )
        return SlackOkResult(ok=True, emoji=inp.emoji, ts=inp.timestamp)
    except Exception as e:
        raise _slack_exc(e)


# ── add reminder ──────────────────────────────────────────────────────────

@tool(
    name="slack_add_reminder",
    description="Create a Slack reminder",
    integration="slack",
    method="POST",
    path="/reminders",
    idempotent=False,
)
async def slack_add_reminder(inp: AddReminderInput) -> SlackReminder:
    try:
        payload: dict = {"text": inp.text, "time": inp.time}
        if inp.user:
            payload["user"] = inp.user
        data = await _slack("reminders.add", json_body=payload)
        r = data.get("reminder", {})
        return SlackReminder(
            id=r.get("id", ""), text=r.get("text", ""),
            user=r.get("creator", ""), time=r.get("time"),
            recurring=r.get("recurring", False),
        )
    except Exception as e:
        raise _slack_exc(e)


# ── add bookmark ──────────────────────────────────────────────────────────

@tool(
    name="slack_add_bookmark",
    description="Add a bookmark to a Slack channel",
    integration="slack",
    method="POST",
    path="/bookmarks",
    idempotent=False,
)
async def slack_add_bookmark(inp: AddBookmarkInput) -> SlackBookmark:
    try:
        payload: dict = {
            "channel_id": inp.channel_id,
            "title": inp.title,
            "type": "link",
            "link": inp.link,
        }
        if inp.emoji:
            payload["emoji"] = inp.emoji
        data = await _slack("bookmarks.add", json_body=payload)
        b = data.get("bookmark", {})
        return SlackBookmark(
            id=b.get("id", ""), title=b.get("title", ""),
            link=b.get("link", ""), emoji=b.get("emoji", ""),
            icon_url=b.get("icon_url", ""), channel_id=inp.channel_id,
        )
    except Exception as e:
        raise _slack_exc(e)


# ── schedule message ──────────────────────────────────────────────────────

@tool(
    name="slack_schedule_message",
    description="Schedule a message to be sent later",
    integration="slack",
    method="POST",
    path="/messages/schedule",
    idempotent=False,
)
async def slack_schedule_message(inp: ScheduleMessageInput) -> SlackScheduledMessage:
    try:
        data = await _slack(
            "chat.scheduleMessage",
            json_body={
                "channel": inp.channel_id,
                "text": inp.text,
                "post_at": inp.post_at,
            },
        )
        return SlackScheduledMessage(
            id=data.get("scheduled_message_id", ""),
            channel=data.get("channel", ""),
            post_at=data.get("post_at"),
            text=inp.text,
        )
    except Exception as e:
        raise _slack_exc(e)


# ── edit message ──────────────────────────────────────────────────────────

@tool(
    name="slack_edit_message",
    description="Edit an existing Slack message",
    integration="slack",
    method="PATCH",
    path="/messages",
    idempotent=False,
)
async def slack_edit_message(inp: EditMessageInput) -> SlackOkResult:
    try:
        await _slack(
            "chat.update",
            json_body={"channel": inp.channel_id, "ts": inp.ts, "text": inp.text},
        )
        return SlackOkResult(ok=True, ts=inp.ts)
    except Exception as e:
        raise _slack_exc(e)


# ── delete message ────────────────────────────────────────────────────────

@tool(
    name="slack_delete_message",
    description="Delete a Slack message",
    integration="slack",
    method="DELETE",
    path="/messages",
    idempotent=False,
)
async def slack_delete_message(inp: DeleteMessageInput) -> SlackOkResult:
    try:
        await _slack(
            "chat.delete",
            json_body={"channel": inp.channel_id, "ts": inp.ts},
        )
        return SlackOkResult(ok=True, ts=inp.ts)
    except Exception as e:
        raise _slack_exc(e)
