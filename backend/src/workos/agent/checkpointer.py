from __future__ import annotations

import os
import logging
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

logger = logging.getLogger(__name__)

_checkpointer: AsyncSqliteSaver | None = None
_checkpointer_cm = None  # context manager handle for cleanup

# Use relative path like the main database; works both local and in Docker
DB_PATH = Path(os.environ.get("CHECKPOINTER_DB_PATH", "data/checkpoints.db"))


async def init_checkpointer() -> AsyncSqliteSaver:
    """Create and set up the singleton checkpointer. Call once at startup."""
    global _checkpointer, _checkpointer_cm
    if _checkpointer is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _checkpointer_cm = AsyncSqliteSaver.from_conn_string(str(DB_PATH))
        _checkpointer = await _checkpointer_cm.__aenter__()
        await _checkpointer.setup()
        logger.info("AsyncSqliteSaver checkpointer initialized at %s", DB_PATH)
    return _checkpointer


async def close_checkpointer() -> None:
    """Shut down the checkpointer. Call once at shutdown."""
    global _checkpointer, _checkpointer_cm
    if _checkpointer_cm is not None:
        await _checkpointer_cm.__aexit__(None, None, None)
        _checkpointer_cm = None
        _checkpointer = None


def get_checkpointer() -> AsyncSqliteSaver:
    """Return the already-initialised checkpointer (raises if not ready)."""
    if _checkpointer is None:
        raise RuntimeError("Checkpointer not initialised – call init_checkpointer() first")
    return _checkpointer
