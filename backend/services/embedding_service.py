"""
Embedding generation service (OpenAI / Ollama).
"""

from __future__ import annotations

import logging
from typing import Sequence

from db.connection import get_pool

log = logging.getLogger(__name__)


async def _get_setting(key: str, default: str = "") -> str:
    pool = get_pool()
    row = await pool.fetchrow("SELECT value FROM ai_settings WHERE key = $1", key)
    return row["value"] if row else default


async def get_embeddings_model():
    """Return a LangChain embeddings model based on stored settings."""
    provider = await _get_setting("embedding_provider", "openai")
    model = await _get_setting("embedding_model", "text-embedding-3-small")

    if provider == "openai":
        api_key = await _get_setting("openai_api_key", "")
        if not api_key:
            raise ValueError("OpenAI API key not configured.")
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(model=model, api_key=api_key)
    elif provider == "ollama":
        base_url = await _get_setting("ollama_base_url", "http://localhost:11434")
        from langchain_ollama import OllamaEmbeddings

        return OllamaEmbeddings(model=model, base_url=base_url)
    else:
        raise ValueError(f"Unknown embedding provider: {provider}")


async def embed_texts(texts: Sequence[str]) -> list[list[float]]:
    """Generate embeddings for a list of texts."""
    model = await get_embeddings_model()
    return await model.aembed_documents(list(texts))


async def embed_query(text: str) -> list[float]:
    """Generate embedding for a single query text."""
    model = await get_embeddings_model()
    return await model.aembed_query(text)
