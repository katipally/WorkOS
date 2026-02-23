"""Pydantic models for Slack tools (Input / Output)."""

from __future__ import annotations

from pydantic import BaseModel


# ── Output models ──────────────────────────────────────────────────────────

class SlackChannel(BaseModel):
    channel_id: str
    channel_name: str = ""
    is_private: bool = False
    num_members: int = 0
    topic: str = ""
    purpose: str = ""


class SlackChannelInfo(BaseModel):
    id: str
    name: str = ""
    topic: str = ""
    purpose: str = ""
    num_members: int = 0
    is_private: bool = False
    created: int | None = None


class SlackMessageFile(BaseModel):
    id: str
    name: str = ""
    title: str = ""
    filetype: str = ""
    size: int = 0
    permalink: str = ""
    thumb_360: str = ""
    mimetype: str = ""


class SlackMessage(BaseModel):
    ts: str
    user: str = ""
    text: str = ""
    reply_count: int = 0
    thread_ts: str | None = None
    reactions: list[dict] = []
    files: list[SlackMessageFile] = []


class SlackThreadMessage(BaseModel):
    ts: str
    user: str = ""
    text: str = ""
    reactions: list[dict] = []
    files: list[SlackMessageFile] = []


class SlackSearchResult(BaseModel):
    ts: str
    channel_id: str = ""
    channel_name: str = ""
    user: str = ""
    text: str = ""
    permalink: str = ""


class SlackUser(BaseModel):
    id: str
    name: str = ""
    display_name: str = ""
    is_bot: bool = False


class SlackPresence(BaseModel):
    user_id: str
    presence: str = "unknown"
    online: bool = False


class SlackPin(BaseModel):
    ts: str = ""
    user: str = ""
    text: str = ""
    created: int | None = None


class SlackPostResult(BaseModel):
    ts: str | None = None
    channel: str | None = None


class SlackOkResult(BaseModel):
    ok: bool = True
    emoji: str = ""
    ts: str = ""
    pinned_ts: str = ""


# ── Input models ───────────────────────────────────────────────────────────

class GetChannelInfoInput(BaseModel):
    channel_id: str


class GetMessagesInput(BaseModel):
    channel_id: str
    hours: int = 0      # 0 = no time limit (fetch all available)
    limit: int = 200


class GetThreadInput(BaseModel):
    channel_id: str
    thread_ts: str


class SearchInput(BaseModel):
    q: str
    channel: str = ""


class PostMessageInput(BaseModel):
    channel_id: str
    text: str
    thread_ts: str = ""


class DMInput(BaseModel):
    user_id: str
    text: str


class ReactionInput(BaseModel):
    channel_id: str
    timestamp: str
    emoji: str


class PinInput(BaseModel):
    channel_id: str
    timestamp: str


class UnpinInput(BaseModel):
    channel_id: str
    timestamp: str


class PresenceInput(BaseModel):
    user_id: str


class GetPinsInput(BaseModel):
    channel_id: str


# ── New Output models (v4.1) ──────────────────────────────────────────────

class SlackFile(BaseModel):
    id: str
    name: str = ""
    title: str = ""
    filetype: str = ""
    size: int = 0
    url_private: str = ""
    user: str = ""
    created: int | None = None
    permalink: str = ""


class SlackReminder(BaseModel):
    id: str
    text: str = ""
    user: str = ""
    time: int | None = None
    complete_ts: int | None = None
    recurring: bool = False


class SlackBookmark(BaseModel):
    id: str
    title: str = ""
    link: str = ""
    emoji: str = ""
    icon_url: str = ""
    channel_id: str = ""


class SlackMember(BaseModel):
    user_id: str
    display_name: str = ""
    is_admin: bool = False


class SlackScheduledMessage(BaseModel):
    id: str = ""
    channel: str = ""
    post_at: int | None = None
    text: str = ""


class SlackEmoji(BaseModel):
    name: str
    url: str = ""


# ── New Input models (v4.1) ──────────────────────────────────────────────

class ListFilesInput(BaseModel):
    channel_id: str = ""
    count: int = 20


class GetFileInfoInput(BaseModel):
    file_id: str


class AddReminderInput(BaseModel):
    text: str
    time: str  # Unix timestamp or natural language
    user: str = ""


class AddBookmarkInput(BaseModel):
    channel_id: str
    title: str
    link: str
    emoji: str = ""


class ListBookmarksInput(BaseModel):
    channel_id: str


class ListChannelMembersInput(BaseModel):
    channel_id: str


class ScheduleMessageInput(BaseModel):
    channel_id: str
    text: str
    post_at: int  # Unix timestamp


class EditMessageInput(BaseModel):
    channel_id: str
    ts: str
    text: str


class DeleteMessageInput(BaseModel):
    channel_id: str
    ts: str


class RemoveReactionInput(BaseModel):
    channel_id: str
    timestamp: str
    emoji: str
