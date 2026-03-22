from __future__ import annotations

import asyncio

import aiosqlite

from workos.config import settings
from workos.db.migrations import run_migrations

_db: aiosqlite.Connection | None = None
_lock = asyncio.Lock()


async def get_db() -> aiosqlite.Connection:
    """Return the singleton DB connection, creating it on first call."""
    global _db
    async with _lock:
        if _db is None:
            _db = await aiosqlite.connect(settings.database_path)
            _db.row_factory = aiosqlite.Row
            await _db.execute("PRAGMA journal_mode=WAL")
            await _db.execute("PRAGMA foreign_keys=ON")
    return _db


async def init_db():
    db = await get_db()
    await run_migrations(db)


async def close_db():
    global _db
    async with _lock:
        if _db is not None:
            await _db.close()
            _db = None
