"""
Pydantic models for Settings tools.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional


class AISettingsOut(BaseModel):
    ai_provider: str = "openai"
    ai_model: str = "gpt-4o"
    embedding_provider: str = "openai"
    embedding_model: str = "text-embedding-3-small"
    meeting_summary_provider: str = "openai"
    meeting_summary_model: str = "gpt-4o-mini"
    meeting_actions_provider: str = "openai"
    meeting_actions_model: str = "gpt-4o-mini"
    vision_provider: str = "openai"
    vision_model: str = "gpt-4o"
    openai_api_key: str = ""
    ollama_base_url: str = "http://host.docker.internal:11434"


class AISettingsUpdate(BaseModel):
    ai_provider: Optional[str] = None
    ai_model: Optional[str] = None
    embedding_provider: Optional[str] = None
    embedding_model: Optional[str] = None
    meeting_summary_provider: Optional[str] = None
    meeting_summary_model: Optional[str] = None
    meeting_actions_provider: Optional[str] = None
    meeting_actions_model: Optional[str] = None
    vision_provider: Optional[str] = None
    vision_model: Optional[str] = None
    openai_api_key: Optional[str] = None
    ollama_base_url: Optional[str] = None


class ModelInfo(BaseModel):
    id: str
    name: str


class ProviderInput(BaseModel):
    provider: str = "openai"
    model_type: str = "chat"  # 'chat' or 'embedding'


class ModelsListOut(BaseModel):
    models: list[ModelInfo] = Field(default_factory=list)


class TestConnectionOut(BaseModel):
    ok: bool
    message: str = ""
