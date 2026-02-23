"""Pydantic models for OAuth tools (Input / Output)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ProviderStatus(BaseModel):
    """Connection status for a single OAuth provider."""
    connected: bool = False
    scope: Optional[str] = None
    meta: Optional[dict] = None
    updated_at: Optional[str] = None


class OAuthStatusOutput(BaseModel):
    """Connection status keyed by provider."""
    github: ProviderStatus = ProviderStatus()
    slack: ProviderStatus = ProviderStatus()
    atlassian: ProviderStatus = ProviderStatus()


class DisconnectInput(BaseModel):
    provider: str


class DisconnectOutput(BaseModel):
    ok: bool = True
    provider: str = ""
