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

log = logging.getLogger(__name__)

# Models that only support temperature=1 (reasoning / chain-of-thought models)
_REASONING_MODEL_PREFIXES = ("o1", "o3", "o4")

# Prefixes for chat/completion models (used when listing models)
_CHAT_MODEL_PREFIXES = ("gpt-4", "gpt-3.5", "gpt-5", "o1", "o3", "o4")

# Prefixes for embedding models
_EMBEDDING_MODEL_PREFIXES = ("text-embedding-",)


def _clamp_temperature(model: str, temperature: float) -> float:
    """Return a model-safe temperature. Reasoning models (o1/o3/o4) only support temperature=1."""
    if any(model.startswith(p) for p in _REASONING_MODEL_PREFIXES):
        return 1.0
    return temperature


async def _get_setting(key: str, default: str = "") -> str:
    """Read a single ai_settings value."""
    pool = get_pool()
    row = await pool.fetchrow("SELECT value FROM ai_settings WHERE key = $1", key)
    return row["value"] if row else default


async def get_llm(
    purpose: str = "ai",
    *,
    streaming: bool = False,
    temperature: float = 0.7,
) -> BaseChatModel:
    """
    Return a LangChain chat model based on stored settings.

    purpose: 'ai' | 'meeting_summary' | 'meeting_actions'
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

    if provider == "openai":
        api_key = await _get_setting("openai_api_key", "")
        if not api_key:
            raise ValueError("OpenAI API key not configured. Set it in Settings → AI Configuration.")
        from langchain_openai import ChatOpenAI

        safe_temp = _clamp_temperature(model, temperature)
        if safe_temp != temperature:
            log.info("Clamped temperature %.1f → %.1f for reasoning model %s", temperature, safe_temp, model)

        return ChatOpenAI(
            model=model,
            api_key=api_key,
            temperature=safe_temp,
            streaming=streaming,
        )
    elif provider == "ollama":
        base_url = await _get_setting("ollama_base_url", "http://localhost:11434")
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=model,
            base_url=base_url,
            temperature=temperature,
        )
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def astream_chat(
    messages: list[BaseMessage],
    purpose: str = "ai",
    temperature: float = 0.7,
) -> AsyncIterator[str]:
    """Stream text tokens from the LLM."""
    llm = await get_llm(purpose, streaming=True, temperature=temperature)
    async for chunk in llm.astream(messages):
        if chunk.content:
            yield chunk.content


async def ainvoke_chat(
    messages: list[BaseMessage],
    purpose: str = "ai",
    temperature: float = 0.7,
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
    prefixes = _EMBEDDING_MODEL_PREFIXES if model_type == "embedding" else _CHAT_MODEL_PREFIXES

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
                        models.append({"id": m["name"], "name": m["name"]})
        except Exception as e:
            log.warning("Failed to list Ollama models: %s", e)
    return models
