"""Shared base models for the tool layer."""

from __future__ import annotations

from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


# -- Generic wrappers -------------------------------------------------------

class EmptyInput(BaseModel):
    """Placeholder for tools that require no input parameters."""
    pass


class ToolResult(BaseModel, Generic[T]):
    """Standard wrapper around any tool output."""

    data: T
    cached: bool = False
    cached_at: datetime | None = None
