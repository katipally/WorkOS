"""
Slack sync tools — pull channels / users from the Slack API and upsert
them into the local DB tables so that list queries are fast.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from db.connection import get_db_pool
from services.slack_client import _slack
from tools import tool
from tools.slack.models import SlackChannel, SlackUser

logger = logging.getLogger(__name__)


# ── helpers ────────────────────────────────────────────────────────────────

def _slack_exc(e: Exception) -> HTTPException:
    """Convert a Slack/httpx error into a FastAPI HTTPException."""
    import httpx
    if isinstance(e, httpx.HTTPStatusError):
        status = e.response.status_code
        try:
            detail = e.response.json().get("error", str(e))
        except Exception:
            detail = str(e)
        return HTTPException(status_code=status if status < 600 else 502, detail=detail)
    if isinstance(e, ValueError) and "not connected" in str(e).lower():
        return HTTPException(status_code=401, detail=str(e))
    return HTTPException(status_code=502, detail=str(e))


# ── sync channels ─────────────────────────────────────────────────────────

@tool(
    name="slack_sync_channels",
    description="Sync Slack channels to local DB",
    integration="slack",
    method="POST",
    path="/channels/sync",
)
async def slack_sync_channels(inp) -> list[SlackChannel]:
    """Fetch channels from Slack API and upsert into slack_channels table."""
    try:
        data = await _slack(
            "conversations.list",
            params={"types": "public_channel,private_channel", "limit": 200, "exclude_archived": "true"},
        )
    except Exception as e:
        raise _slack_exc(e)

    channels: list[SlackChannel] = []
    pool = await get_db_pool()

    for c in data.get("channels", []):
        ch = SlackChannel(
            channel_id=c["id"],
            channel_name=c.get("name", c["id"]),
            is_private=c.get("is_private", False),
            num_members=c.get("num_members", 0),
            topic=c.get("topic", {}).get("value", ""),
            purpose=c.get("purpose", {}).get("value", ""),
        )
        channels.append(ch)
        await pool.execute(
            """INSERT INTO slack_channels (channel_id, channel_name, is_private, num_members, topic, purpose, synced_at)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())
               ON CONFLICT (channel_id) DO UPDATE SET
                   channel_name = EXCLUDED.channel_name,
                   is_private   = EXCLUDED.is_private,
                   num_members  = EXCLUDED.num_members,
                   topic        = EXCLUDED.topic,
                   purpose      = EXCLUDED.purpose,
                   synced_at    = NOW()""",
            ch.channel_id, ch.channel_name, ch.is_private,
            ch.num_members, ch.topic, ch.purpose,
        )

    logger.info("[slack_sync_channels] upserted %d channels", len(channels))
    return channels


# ── sync users ────────────────────────────────────────────────────────────

@tool(
    name="slack_sync_users",
    description="Sync Slack users to local DB",
    integration="slack",
    method="POST",
    path="/users/sync",
)
async def slack_sync_users(inp) -> list[SlackUser]:
    """Fetch workspace members from Slack API and upsert into slack_users table."""
    try:
        data = await _slack("users.list", params={"limit": 200})
    except Exception as e:
        raise _slack_exc(e)

    users: list[SlackUser] = []
    pool = await get_db_pool()

    for u in data.get("members", []):
        if u.get("deleted") or u.get("is_ultra_restricted"):
            continue
        usr = SlackUser(
            id=u["id"],
            name=u.get("real_name", u["name"]),
            display_name=u["profile"].get("display_name", ""),
            is_bot=u.get("is_bot", False),
        )
        users.append(usr)
        await pool.execute(
            """INSERT INTO slack_users (user_id, name, display_name, is_bot, synced_at)
               VALUES ($1, $2, $3, $4, NOW())
               ON CONFLICT (user_id) DO UPDATE SET
                   name         = EXCLUDED.name,
                   display_name = EXCLUDED.display_name,
                   is_bot       = EXCLUDED.is_bot,
                   synced_at    = NOW()""",
            usr.id, usr.name, usr.display_name, usr.is_bot,
        )

    logger.info("[slack_sync_users] upserted %d users", len(users))
    return users
