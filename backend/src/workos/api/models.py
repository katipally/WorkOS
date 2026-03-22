from __future__ import annotations

import httpx
from fastapi import APIRouter

from workos.config import settings
from workos.db.database import get_db

router = APIRouter(tags=["models"])


@router.get("/models")
async def list_models():
    """Fetch available models from Ollama."""
    # Use URL from DB if set, else config default
    db = await get_db()
    cursor = await db.execute("SELECT value FROM settings WHERE key = 'ollama_url'")
    row = await cursor.fetchone()
    url = row[0] if row else settings.ollama_url

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{url}/api/tags")
        resp.raise_for_status()
        data = resp.json()

    models = []
    for m in data.get("models", []):
        models.append(
            {
                "name": m["name"],
                "size": m.get("size"),
                "modified_at": m.get("modified_at"),
                "digest": m.get("digest"),
            }
        )
    return {"models": models}
