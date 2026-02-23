"""
Provider-agnostic LLM wrapper supporting OpenAI and Ollama.

Handles model-specific temperature constraints:
- o1, o3, o4 reasoning models only support temperature=1
- GPT-4, GPT-4o, GPT-3.5, GPT-5 support full temperature range
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage, AIMessage
from langchain_core.language_models import BaseChatModel

from db.connection import get_pool
from services.agent.config import (
    REASONING_MODEL_PREFIXES,
    CHAT_MODEL_PREFIXES,
    EMBEDDING_MODEL_PREFIXES,
    DEFAULT_TEMPERATURE,
)

log = logging.getLogger(__name__)


def _clamp_temperature(model: str, temperature: float) -> float:
    """Return a model-safe temperature. Reasoning models (o1/o3/o4) only support temperature=1."""
    if any(model.startswith(p) for p in REASONING_MODEL_PREFIXES):
        return 1.0
    return temperature


def is_reasoning_model(model: str) -> bool:
    """Return True if the model is a reasoning/chain-of-thought model (o1/o3/o4)."""
    return any(model.startswith(p) for p in REASONING_MODEL_PREFIXES)


async def _get_setting(key: str, default: str = "") -> str:
    """Read a single ai_settings value."""
    pool = get_pool()
    row = await pool.fetchrow("SELECT value FROM ai_settings WHERE key = $1", key)
    return row["value"] if row else default


async def get_llm(
    purpose: str = "ai",
    *,
    streaming: bool = False,
    temperature: float | None = None,
) -> BaseChatModel:
    """
    Return a LangChain chat model based on stored settings.

    purpose: 'ai' | 'meeting_summary' | 'meeting_actions'
    temperature: If None, reads from DB (ai_temperature setting), falling
                 back to DEFAULT_TEMPERATURE from config.
    """
    if purpose == "ai":
        provider = await _get_setting("ai_provider", "openai")
        model = await _get_setting("ai_model", "gpt-4o")
    elif purpose == "meeting_summary":
        provider = await _get_setting("meeting_summary_provider", "openai")
        model = await _get_setting("meeting_summary_model", "gpt-4o-mini")
    elif purpose == "meeting_actions":
        provider = await _get_setting("meeting_actions_provider", "openai")
        model = await _get_setting("meeting_actions_model", "gpt-4o-mini")
    else:
        provider = "openai"
        model = "gpt-4o"

    # Resolve temperature: explicit arg → DB → config default
    if temperature is None:
        raw = await _get_setting("ai_temperature", "")
        temperature = float(raw) if raw else DEFAULT_TEMPERATURE

    if provider == "openai":
        api_key = await _get_setting("openai_api_key", "")
        if not api_key:
            raise ValueError("OpenAI API key not configured. Set it in Settings → AI Configuration.")
        from langchain_openai import ChatOpenAI

        safe_temp = _clamp_temperature(model, temperature)
        if safe_temp != temperature:
            log.info("Clamped temperature %.1f → %.1f for reasoning model %s", temperature, safe_temp, model)

        # Reasoning models (o1/o3/o4) do not support token-level streaming
        effective_streaming = streaming and not is_reasoning_model(model)

        return ChatOpenAI(
            model=model,
            api_key=api_key,
            temperature=safe_temp,
            streaming=effective_streaming,
        )
    elif provider == "ollama":
        base_url = await _get_setting("ollama_base_url", "http://localhost:11434")
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=model,
            base_url=base_url,
            temperature=temperature,
            streaming=streaming,
            num_ctx=8192,  # Ensure adequate context window for tools + RAG
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def get_current_model_name() -> str:
    """Return the currently selected AI model name (for display purposes)."""
    return await _get_setting("ai_model", "gpt-4o")


async def astream_chat(
    messages: list[BaseMessage],
    purpose: str = "ai",
    temperature: float | None = None,
) -> AsyncIterator[str]:
    """Stream text tokens from the LLM."""
    llm = await get_llm(purpose, streaming=True, temperature=temperature)
    async for chunk in llm.astream(messages):
        if chunk.content:
            yield chunk.content


async def ainvoke_chat(
    messages: list[BaseMessage],
    purpose: str = "ai",
    temperature: float | None = None,
) -> str:
    """Invoke LLM and return full response text."""
    llm = await get_llm(purpose, streaming=False, temperature=temperature)
    result = await llm.ainvoke(messages)
    return result.content


async def list_available_models(provider: str, model_type: str = "chat") -> list[dict]:
    """List models available from a provider.

    model_type: 'chat' for LLM/completion models, 'embedding' for embedding models.
    """
    models: list[dict] = []
    prefixes = EMBEDDING_MODEL_PREFIXES if model_type == "embedding" else CHAT_MODEL_PREFIXES

    if provider == "openai":
        api_key = await _get_setting("openai_api_key", "")
        if not api_key:
            return []
        try:
            import openai

            client = openai.AsyncOpenAI(api_key=api_key)
            resp = await client.models.list()
            for m in resp.data:
                if any(m.id.startswith(prefix) for prefix in prefixes):
                    models.append({"id": m.id, "name": m.id})
            models.sort(key=lambda x: x["id"])
        except Exception as e:
            log.warning("Failed to list OpenAI models: %s", e)
    elif provider == "ollama":
        base_url = await _get_setting("ollama_base_url", "http://localhost:11434")
        try:
            import httpx

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(f"{base_url}/api/tags")
                if resp.status_code == 200:
                    data = resp.json()
                    for m in data.get("models", []):
                        name = m["name"]
                        # For embedding model listing, prefer models with
                        # "embed" in the name; for chat, exclude them.
                        is_embed_model = "embed" in name.lower()
                        if model_type == "embedding" and is_embed_model:
                            models.append({"id": name, "name": name})
                        elif model_type != "embedding" and not is_embed_model:
                            models.append({"id": name, "name": name})
                    # If no embedding models found, return all (user
                    # may use any model for embeddings via Ollama)
                    if model_type == "embedding" and not models:
                        for m in data.get("models", []):
                            models.append({"id": m["name"], "name": m["name"]})
        except Exception as e:
            log.warning("Failed to list Ollama models: %s", e)
    return models
