"""
Pydantic schemas for AI chat endpoints — request and response models.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ─── Chat ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    session_id: Optional[str] = None
    message: str
    focused_tab: str = "slack"
    scope: str = "workspace"
    branch_id: int = 1
    context_mentions: list[str] = Field(default_factory=list)
    # Current view context — passed so the agent knows what the user is looking at
    selected_repo: Optional[str] = None
    selected_channel: Optional[str] = None
    selected_channel_name: Optional[str] = None


class StopRequest(BaseModel):
    session_id: str


class ApprovalRequest(BaseModel):
    session_id: str
    approved: bool


# ─── Sessions ────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    title: str = "New Chat"
    focused_tab: str = "slack"
    scope: str = "workspace"


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    scope: Optional[str] = None
    branch_id: Optional[int] = None
