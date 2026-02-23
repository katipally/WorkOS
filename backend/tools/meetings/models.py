"""
Pydantic models for Meetings tools.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class MeetingCreate(BaseModel):
    title: str = "Untitled Meeting"
    description: str = ""
    meeting_date: Optional[str] = None


class MeetingIdInput(BaseModel):
    meeting_id: str


class MeetingOut(BaseModel):
    id: str
    title: str
    description: str
    meeting_date: str
    status: str
    summary: Optional[str] = None
    action_items: list[dict] = Field(default_factory=list)
    error: Optional[str] = None
    created_at: str
    updated_at: str
    files: list[dict] = Field(default_factory=list)


class MeetingsListOut(BaseModel):
    meetings: list[MeetingOut]


class MeetingFileOut(BaseModel):
    id: str
    meeting_id: str
    filename: str
    filetype: str
    filesize: int
    mime_type: str
    status: str
    transcription: Optional[str] = None


class ActionItem(BaseModel):
    text: str
    assignee: Optional[str] = None
    due_date: Optional[str] = None
    completed: bool = False
