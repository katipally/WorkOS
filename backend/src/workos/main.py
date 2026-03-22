import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from workos.api import chat, mcp_servers, models, services, settings, threads
from workos.config import settings as app_settings
from workos.db.database import close_db, init_db
from workos.mcp.manager import mcp_manager

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.dirname(app_settings.database_path) or ".", exist_ok=True)
    await init_db()

    # Initialise the checkpointer singleton (must happen before any graph usage)
    from workos.agent.checkpointer import init_checkpointer, close_checkpointer
    await init_checkpointer()

    # Pre-initialize MCP servers so the first request doesn't pay the cost
    # and concurrent first requests don't race to spawn duplicate processes.
    await mcp_manager.initialize()

    logger.info("WorkOS backend started")
    yield
    await mcp_manager.shutdown()
    await close_checkpointer()
    await close_db()
    logger.info("WorkOS backend stopped")


app = FastAPI(
    title="WorkOS API",
    description="ReAct Loop AI Agent Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=app_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(threads.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(mcp_servers.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(services.router, prefix="/api")


@app.get("/api/health")
async def health():
    from workos.mcp.manager import mcp_manager

    tools = await mcp_manager.get_tools()
    return {
        "status": "ok",
        "mcp_tools_count": len(tools),
        "mcp_initialized": mcp_manager._initialized,
    }
