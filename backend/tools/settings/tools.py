"""
Settings tools — AI model configuration management.
"""

from __future__ import annotations

import logging

from tools import tool
from tools.base import EmptyInput
from tools.settings.models import (
    AISettingsOut,
    AISettingsUpdate,
    ModelsListOut,
    ModelInfo,
    ProviderInput,
    TestConnectionOut,
)
from db.connection import get_pool
from services.ai_service import list_available_models

log = logging.getLogger(__name__)

# All known setting keys
SETTING_KEYS = [
    "ai_provider", "ai_model",
    "embedding_provider", "embedding_model",
    "meeting_summary_provider", "meeting_summary_model",
    "meeting_actions_provider", "meeting_actions_model",
    "openai_api_key", "ollama_base_url",
]


@tool(
    name="settings_get_ai",
    description="Get all AI configuration settings",
    integration="settings",
    method="GET",
    path="/ai",
)
async def settings_get_ai(inp: EmptyInput) -> AISettingsOut:
    """Get all AI configuration settings."""
    pool = get_pool()
    rows = await pool.fetch("SELECT key, value FROM ai_settings")
    values = {r["key"]: r["value"] for r in rows}

    # Mask API key for security (return only last 4 chars)
    api_key = values.get("openai_api_key", "")
    if api_key and len(api_key) > 4:
        values["openai_api_key"] = "sk-..." + api_key[-4:]

    return AISettingsOut(**{k: values.get(k, getattr(AISettingsOut(), k)) for k in SETTING_KEYS})


@tool(
    name="settings_update_ai",
    description="Update AI configuration settings",
    integration="settings",
    method="PUT",
    path="/ai",
)
async def settings_update_ai(body: AISettingsUpdate) -> AISettingsOut:
    """Update AI configuration settings."""
    pool = get_pool()

    updates = body.model_dump(exclude_none=True)
    for key, value in updates.items():
        if key in SETTING_KEYS:
            await pool.execute(
                """INSERT INTO ai_settings (key, value, updated_at)
                   VALUES ($1, $2, NOW())
                   ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()""",
                key, str(value),
            )

    # Return updated settings
    return await settings_get_ai(EmptyInput())


@tool(
    name="settings_list_models",
    description="List available models for a given provider (openai or ollama)",
    integration="settings",
    method="GET",
    path="/ai/models",
)
async def settings_list_models(inp: ProviderInput) -> ModelsListOut:
    """List available models for a given provider (openai or ollama)."""
    models = await list_available_models(inp.provider, model_type=inp.model_type)
    return ModelsListOut(models=[ModelInfo(**m) for m in models])


@tool(
    name="settings_test_connection",
    description="Test connection to an AI provider",
    integration="settings",
    method="POST",
    path="/ai/test",
)
async def settings_test_connection(inp: ProviderInput) -> TestConnectionOut:
    """Test connection to an AI provider."""
    pool = get_pool()
    provider = inp.provider

    try:
        if provider == "openai":
            api_key_row = await pool.fetchrow(
                "SELECT value FROM ai_settings WHERE key = 'openai_api_key'"
            )
            api_key = api_key_row["value"] if api_key_row else ""
            if not api_key:
                return TestConnectionOut(ok=False, message="OpenAI API key not set")

            import openai

            client = openai.AsyncOpenAI(api_key=api_key)
            resp = await client.models.list()
            count = sum(1 for _ in resp.data)
            return TestConnectionOut(ok=True, message=f"Connected. {count} models available.")

        elif provider == "ollama":
            base_url_row = await pool.fetchrow(
                "SELECT value FROM ai_settings WHERE key = 'ollama_base_url'"
            )
            base_url = base_url_row["value"] if base_url_row else "http://localhost:11434"

            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{base_url}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("models", [])
                    return TestConnectionOut(
                        ok=True,
                        message=f"Connected. {len(models)} models available.",
                    )
                return TestConnectionOut(ok=False, message=f"Status {resp.status_code}")
        else:
            return TestConnectionOut(ok=False, message=f"Unknown provider: {provider}")

    except Exception as e:
        return TestConnectionOut(ok=False, message=str(e)[:200])
