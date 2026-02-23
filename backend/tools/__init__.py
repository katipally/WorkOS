"""
Tool-based architecture core.

Every backend action is a *tool* — an async function with typed Pydantic
Input / Output models, metadata for auto-route generation, and optional
DB-caching support.

Usage
-----
    from tools import tool, registry

    class MyInput(BaseModel):
        name: str

    class MyOutput(BaseModel):
        greeting: str

    @tool(
        name="say_hello",
        description="Greets the user",
        integration="system",
        method="GET",
        path="/hello",
    )
    async def say_hello(inp: MyInput) -> MyOutput:
        return MyOutput(greeting=f"Hello, {inp.name}!")

On import the tool is automatically added to ``registry``.  At startup,
``mount_tools(app, registry)`` reads the registry and creates FastAPI
routes for each tool.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, get_type_hints

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Metadata attached to each tool function
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ToolMeta:
    """Describes a tool for the registry and auto-route generator."""

    name: str
    description: str
    integration: str                         # github | slack | jira | oauth | system
    method: str                              # GET | POST | PATCH | PUT | DELETE
    path: str                                # route path relative to /api/{integration}
    tags: list[str] = field(default_factory=list)
    cache_ttl: int | None = None             # seconds; None → never cache
    idempotent: bool = True
    # Resolved at registration time by introspecting the function signature
    input_model: type[BaseModel] | None = None
    output_model: type[BaseModel] | None = None


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

ToolFn = Callable[..., Awaitable[Any]]


class ToolRegistry:
    """Central store for all registered tools."""

    def __init__(self) -> None:
        self._tools: dict[str, tuple[ToolMeta, ToolFn]] = {}

    # -- mutators -----------------------------------------------------------

    def register(self, meta: ToolMeta, fn: ToolFn) -> None:
        if meta.name in self._tools:
            raise ValueError(f"Duplicate tool name: {meta.name!r}")
        self._tools[meta.name] = (meta, fn)

    # -- accessors ----------------------------------------------------------

    def get(self, name: str) -> tuple[ToolMeta, ToolFn]:
        return self._tools[name]

    def list_tools(self, integration: str | None = None) -> list[ToolMeta]:
        metas = [m for m, _ in self._tools.values()]
        if integration:
            metas = [m for m in metas if m.integration == integration]
        return sorted(metas, key=lambda m: m.name)

    def all(self) -> dict[str, tuple[ToolMeta, ToolFn]]:
        return dict(self._tools)

    def __len__(self) -> int:
        return len(self._tools)


# Global singleton
registry = ToolRegistry()


# ---------------------------------------------------------------------------
# Decorator
# ---------------------------------------------------------------------------

def tool(
    *,
    name: str,
    description: str,
    integration: str,
    method: str = "GET",
    path: str,
    tags: list[str] | None = None,
    cache_ttl: int | None = None,
    idempotent: bool = True,
) -> Callable[[ToolFn], ToolFn]:
    """Decorator that registers an async function as a tool."""

    def decorator(fn: ToolFn) -> ToolFn:
        # Introspect Input / Output models from type hints
        hints = get_type_hints(fn)
        sig = inspect.signature(fn)

        input_model: type[BaseModel] | None = None
        for param_name, param in sig.parameters.items():
            hint = hints.get(param_name)
            if hint and isinstance(hint, type) and issubclass(hint, BaseModel):
                input_model = hint
                break

        output_model = hints.get("return")

        meta = ToolMeta(
            name=name,
            description=description,
            integration=integration,
            method=method.upper(),
            path=path,
            tags=tags or [integration],
            cache_ttl=cache_ttl,
            idempotent=idempotent,
            input_model=input_model,
            output_model=output_model,
        )

        # Attach metadata to the function for introspection
        fn._tool_meta = meta  # type: ignore[attr-defined]

        # Auto-register
        registry.register(meta, fn)
        return fn

    return decorator
