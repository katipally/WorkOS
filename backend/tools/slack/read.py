"""
Slack read tools — query channels, messages, threads, pins, presence.

Sync-backed tools (channels/users) read from the local DB first, falling
back to a live sync when the table is empty.  Everything else is always
fetched live from the Slack API.
"""

from __future__ import annotations

import time

from db.connection import get_db_pool
from services.slack_client import _slack
from tools import tool
from tools.slack.models import (
    GetChannelInfoInput,
    GetMessagesInput,
    GetPinsInput,
    GetThreadInput,
    ListBookmarksInput,
    ListChannelMembersInput,
    ListFilesInput,
    GetFileInfoInput,
    PresenceInput,
    SearchInput,
    SlackBookmark,
    SlackChannel,
    SlackChannelInfo,
    SlackEmoji,
    SlackFile,
    SlackMember,
    SlackMessage,
    SlackMessageFile,
    SlackPin,
    SlackPresence,
    SlackReminder,
    SlackSearchResult,
    SlackThreadMessage,
    SlackUser,
)
from tools.slack.sync import _slack_exc, slack_sync_channels, slack_sync_users
from tools.base import EmptyInput


def _extract_files(m: dict) -> list[SlackMessageFile]:
    """Extract files attached to a Slack message."""
    return [
        SlackMessageFile(
            id=f.get("id", ""),
            name=f.get("name", ""),
            title=f.get("title", ""),
            filetype=f.get("filetype", ""),
            size=f.get("size", 0),
            permalink=f.get("permalink", ""),
            thumb_360=f.get("thumb_360", ""),
            mimetype=f.get("mimetype", ""),
        )
        for f in m.get("files", [])
    ]


# ── channels (DB-backed) ──────────────────────────────────────────────────

@tool(
    name="slack_list_channels",
    description="List Slack channels (from local DB, auto-syncs if empty)",
    integration="slack",
    method="GET",
    path="/channels",
)
async def slack_list_channels(inp: EmptyInput) -> list[SlackChannel]:
    pool = await get_db_pool()
    rows = await pool.fetch("SELECT * FROM slack_channels ORDER BY channel_name")
    if not rows:
        return await slack_sync_channels(inp)
    return [
        SlackChannel(
            channel_id=r["channel_id"],
            channel_name=r["channel_name"],
            is_private=r["is_private"],
            num_members=r["num_members"],
            topic=r["topic"],
            purpose=r["purpose"],
        )
        for r in rows
    ]


# ── users (DB-backed) ────────────────────────────────────────────────────

@tool(
    name="slack_list_users",
    description="List Slack workspace members (from local DB, auto-syncs if empty)",
    integration="slack",
    method="GET",
    path="/users",
)
async def slack_list_users(inp: EmptyInput) -> list[SlackUser]:
    pool = await get_db_pool()
    rows = await pool.fetch("SELECT * FROM slack_users ORDER BY name")
    if not rows:
        return await slack_sync_users(inp)
    return [
        SlackUser(
            id=r["user_id"],
            name=r["name"],
            display_name=r["display_name"],
            is_bot=r["is_bot"],
        )
        for r in rows
    ]


# ── channel info (live) ──────────────────────────────────────────────────

@tool(
    name="slack_get_channel_info",
    description="Get detailed info for a Slack channel",
    integration="slack",
    method="GET",
    path="/channels/{channel_id}/info",
)
async def slack_get_channel_info(inp: GetChannelInfoInput) -> SlackChannelInfo:
    try:
        data = await _slack("conversations.info", params={"channel": inp.channel_id, "include_num_members": "true"})
    except Exception as e:
        raise _slack_exc(e)

    c = data.get("channel", {})
    return SlackChannelInfo(
        id=c["id"],
        name=c.get("name", inp.channel_id),
        topic=c.get("topic", {}).get("value", ""),
        purpose=c.get("purpose", {}).get("value", ""),
        num_members=c.get("num_members", 0),
        is_private=c.get("is_private", False),
        created=c.get("created"),
    )


# ── messages (live) ──────────────────────────────────────────────────────

@tool(
    name="slack_get_messages",
    description="Fetch messages from a Slack channel (all messages by default, or limited by hours)",
    integration="slack",
    method="GET",
    path="/channels/{channel_id}/messages",
)
async def slack_get_messages(inp: GetMessagesInput) -> list[SlackMessage]:
    try:
        params: dict = {"channel": inp.channel_id, "limit": min(inp.limit, 200)}
        if inp.hours and inp.hours > 0:
            params["oldest"] = str(time.time() - inp.hours * 3600)

        all_raw: list = []
        while True:
            data = await _slack("conversations.history", params=params)
            all_raw.extend(data.get("messages", []))
            # Stop if we've gathered enough or there are no more pages
            if len(all_raw) >= inp.limit:
                all_raw = all_raw[:inp.limit]
                break
            cursor = data.get("response_metadata", {}).get("next_cursor")
            if not cursor:
                break
            params["cursor"] = cursor
    except Exception as e:
        raise _slack_exc(e)

    messages: list[SlackMessage] = []
    for m in reversed(all_raw):
        if m.get("subtype") in ("channel_join", "channel_leave"):
            continue
        reactions = [
            {"emoji": r["name"], "count": r["count"], "users": r.get("users", [])}
            for r in m.get("reactions", [])
        ]
        messages.append(
            SlackMessage(
                ts=m["ts"],
                user=m.get("user", m.get("username", "bot")),
                text=m.get("text", ""),
                reply_count=m.get("reply_count", 0),
                thread_ts=m.get("thread_ts"),
                reactions=reactions,
                files=_extract_files(m),
            )
        )
    return messages


# ── thread (live) ─────────────────────────────────────────────────────────

@tool(
    name="slack_get_thread",
    description="Fetch all replies in a Slack thread",
    integration="slack",
    method="GET",
    path="/thread/{channel_id}/{thread_ts}",
)
async def slack_get_thread(inp: GetThreadInput) -> list[SlackThreadMessage]:
    try:
        data = await _slack(
            "conversations.replies",
            params={"channel": inp.channel_id, "ts": inp.thread_ts, "limit": 100},
        )
    except Exception as e:
        raise _slack_exc(e)

    return [
        SlackThreadMessage(
            ts=m["ts"],
            user=m.get("user", "bot"),
            text=m.get("text", ""),
            reactions=[
                {"emoji": r["name"], "count": r["count"], "users": r.get("users", [])}
                for r in m.get("reactions", [])
            ],
            files=_extract_files(m),
        )
        for m in data.get("messages", [])
    ]


# ── search (live) ─────────────────────────────────────────────────────────

@tool(
    name="slack_search_messages",
    description="Search Slack messages across channels",
    integration="slack",
    method="GET",
    path="/search",
)
async def slack_search_messages(inp: SearchInput) -> list[SlackSearchResult]:
    try:
        search_q = f"in:#{inp.channel} {inp.q}" if inp.channel else inp.q
        data = await _slack("search.messages", params={"query": search_q, "count": 20, "sort": "timestamp"})
    except Exception as e:
        raise _slack_exc(e)

    matches = data.get("messages", {}).get("matches", [])
    return [
        SlackSearchResult(
            ts=m["ts"],
            channel_id=m["channel"]["id"],
            channel_name=m["channel"]["name"],
            user=m.get("username", m.get("user", "")),
            text=m.get("text", ""),
            permalink=m.get("permalink", ""),
        )
        for m in matches
    ]


# ── pins (live) ───────────────────────────────────────────────────────────

@tool(
    name="slack_get_pins",
    description="List pinned messages in a Slack channel",
    integration="slack",
    method="GET",
    path="/channels/{channel_id}/pins",
)
async def slack_get_pins(inp: GetPinsInput) -> list[SlackPin]:
    try:
        data = await _slack("pins.list", params={"channel": inp.channel_id})
    except Exception as e:
        raise _slack_exc(e)

    items = data.get("items", [])
    return [
        SlackPin(
            ts=i.get("message", {}).get("ts", ""),
            user=i.get("message", {}).get("user", ""),
            text=i.get("message", {}).get("text", ""),
            created=i.get("created"),
        )
        for i in items
        if i.get("type") == "message"
    ]


# ── user presence (live) ─────────────────────────────────────────────────

@tool(
    name="slack_get_user_presence",
    description="Check if a Slack user is online",
    integration="slack",
    method="GET",
    path="/users/{user_id}/presence",
)
async def slack_get_user_presence(inp: PresenceInput) -> SlackPresence:
    try:
        data = await _slack("users.getPresence", params={"user": inp.user_id})
    except Exception as e:
        raise _slack_exc(e)

    return SlackPresence(
        user_id=inp.user_id,
        presence=data.get("presence", "unknown"),
        online=data.get("online", False),
    )


# ── files (live) ──────────────────────────────────────────────────────────

@tool(
    name="slack_list_files",
    description="List files shared in a Slack channel (or workspace)",
    integration="slack",
    method="GET",
    path="/files",
)
async def slack_list_files(inp: ListFilesInput) -> list[SlackFile]:
    try:
        params: dict = {"count": min(inp.count, 100)}
        if inp.channel_id:
            params["channel"] = inp.channel_id
        data = await _slack("files.list", params=params)
    except Exception as e:
        raise _slack_exc(e)

    return [
        SlackFile(
            id=f["id"], name=f.get("name", ""), title=f.get("title", ""),
            filetype=f.get("filetype", ""), size=f.get("size", 0),
            url_private=f.get("url_private", ""), user=f.get("user", ""),
            created=f.get("created"), permalink=f.get("permalink", ""),
        )
        for f in data.get("files", [])
    ]


# ── file info (live) ──────────────────────────────────────────────────────

@tool(
    name="slack_get_file_info",
    description="Get detailed info for a Slack file",
    integration="slack",
    method="GET",
    path="/files/{file_id}",
)
async def slack_get_file_info(inp: GetFileInfoInput) -> SlackFile:
    try:
        data = await _slack("files.info", params={"file": inp.file_id})
    except Exception as e:
        raise _slack_exc(e)

    f = data.get("file", {})
    return SlackFile(
        id=f["id"], name=f.get("name", ""), title=f.get("title", ""),
        filetype=f.get("filetype", ""), size=f.get("size", 0),
        url_private=f.get("url_private", ""), user=f.get("user", ""),
        created=f.get("created"), permalink=f.get("permalink", ""),
    )


# ── reminders (live) ─────────────────────────────────────────────────────

@tool(
    name="slack_list_reminders",
    description="List the current user's Slack reminders",
    integration="slack",
    method="GET",
    path="/reminders",
)
async def slack_list_reminders(inp: EmptyInput) -> list[SlackReminder]:
    try:
        data = await _slack("reminders.list")
    except Exception as e:
        raise _slack_exc(e)

    return [
        SlackReminder(
            id=r["id"], text=r.get("text", ""), user=r.get("creator", ""),
            time=r.get("time"), complete_ts=r.get("complete_ts", 0),
            recurring=r.get("recurring", False),
        )
        for r in data.get("reminders", [])
    ]


# ── bookmarks (live) ─────────────────────────────────────────────────────

@tool(
    name="slack_list_bookmarks",
    description="List bookmarks in a Slack channel",
    integration="slack",
    method="GET",
    path="/channels/{channel_id}/bookmarks",
)
async def slack_list_bookmarks(inp: ListBookmarksInput) -> list[SlackBookmark]:
    try:
        data = await _slack("bookmarks.list", params={"channel_id": inp.channel_id})
    except Exception as e:
        raise _slack_exc(e)

    return [
        SlackBookmark(
            id=b["id"], title=b.get("title", ""), link=b.get("link", ""),
            emoji=b.get("emoji", ""), icon_url=b.get("icon_url", ""),
            channel_id=inp.channel_id,
        )
        for b in data.get("bookmarks", [])
    ]


# ── channel members (live) ───────────────────────────────────────────────

@tool(
    name="slack_list_channel_members",
    description="List members in a Slack channel",
    integration="slack",
    method="GET",
    path="/channels/{channel_id}/members",
)
async def slack_list_channel_members(inp: ListChannelMembersInput) -> list[SlackMember]:
    try:
        data = await _slack("conversations.members", params={"channel": inp.channel_id, "limit": 200})
    except Exception as e:
        raise _slack_exc(e)

    member_ids = data.get("members", [])
    members: list[SlackMember] = []
    # Resolve names from the DB
    pool = await get_db_pool()
    for uid in member_ids:
        row = await pool.fetchrow("SELECT name, display_name FROM slack_users WHERE user_id = $1", uid)
        members.append(SlackMember(
            user_id=uid,
            display_name=row["display_name"] or row["name"] if row else uid,
        ))
    return members


# ── emoji (live) ──────────────────────────────────────────────────────────

@tool(
    name="slack_list_emoji",
    description="List custom emoji in the Slack workspace",
    integration="slack",
    method="GET",
    path="/emoji",
)
async def slack_list_emoji(inp: EmptyInput) -> list[SlackEmoji]:
    try:
        data = await _slack("emoji.list")
    except Exception as e:
        raise _slack_exc(e)

    emoji_map = data.get("emoji", {})
    return [SlackEmoji(name=k, url=v) for k, v in emoji_map.items()]
