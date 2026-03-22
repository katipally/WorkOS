from __future__ import annotations

from fastapi import APIRouter

from workos.config import settings as app_settings
from workos.db.database import get_db
from workos.db.models import SettingsOut, SettingsUpdate

router = APIRouter(tags=["settings"])


async def _get_settings_dict() -> dict:
    db = await get_db()
    cursor = await db.execute("SELECT key, value FROM settings")
    rows = await cursor.fetchall()
    return {r[0]: r[1] for r in rows}


async def _set_setting(key: str, value: str) -> None:
    db = await get_db()
    await db.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    await db.commit()


@router.get("/settings", response_model=SettingsOut)
async def get_settings():
    data = await _get_settings_dict()
    return SettingsOut(
        ollama_model=data.get("ollama_model") or app_settings.ollama_model,
        ollama_url=data.get("ollama_url") or app_settings.ollama_url,
        max_steps=int(data.get("max_steps", str(app_settings.max_steps))),
        system_prompt=data.get("system_prompt") or app_settings.system_prompt,
        theme=data.get("theme", "system"),
    )


@router.put("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate):
    if body.ollama_model is not None:
        await _set_setting("ollama_model", body.ollama_model)
    if body.ollama_url is not None:
        await _set_setting("ollama_url", body.ollama_url)
    if body.max_steps is not None:
        await _set_setting("max_steps", str(body.max_steps))
    if body.system_prompt is not None:
        await _set_setting("system_prompt", body.system_prompt)
    if body.theme is not None:
        await _set_setting("theme", body.theme)
    return await get_settings()
