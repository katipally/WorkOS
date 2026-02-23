from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from core.errors import register_error_handlers
from db.connection import init_db_pool, close_db_pool, run_migrations, _refresh_collation

# Import tool packages — triggers @tool registration on each import
import tools.slack   # noqa: F401
import tools.github  # noqa: F401
import tools.oauth.tools  # noqa: F401
import tools.meetings  # noqa: F401
import tools.settings  # noqa: F401

from tools import registry
from tools.registry import mount_tools

# OAuth authorize/callback still served as a normal router (HTML responses)
from routers import oauth as oauth_router
# AI routers — split by concern
from routers import ai_chat, ai_sessions, ai_features


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db_pool(settings.DATABASE_URL)
    await run_migrations()
    await _refresh_collation()
    yield
    await close_db_pool()


app = FastAPI(title="WorkOS", version="4.0.0", lifespan=lifespan)

# Register custom error handlers
register_error_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "https://localhost:3443",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auto-mount all registered tools as REST routes
mount_tools(app, registry)

# OAuth authorize/callback (HTML popup flow — cannot be a tool)
app.include_router(oauth_router.router, prefix="/api/oauth", tags=["oauth"])

# AI routers (split by concern)
app.include_router(ai_chat.router)      # SSE streaming + stop
app.include_router(ai_sessions.router)  # Session CRUD
app.include_router(ai_features.router)  # Branching, pinning, upload, approval


# ── Meeting file upload (multipart/form-data — not a tool) ────────────────
from fastapi import UploadFile, File, Form

@app.post("/api/meetings/{meeting_id}/upload", tags=["meetings"])
async def upload_meeting_file(meeting_id: str, file: UploadFile = File(...)):
    """Upload a file (transcript, audio, video) to a meeting."""
    from tools.meetings.write import meetings_upload_file
    content = await file.read()
    result = await meetings_upload_file(
        meeting_id=meeting_id,
        filename=file.filename or "file",
        content=content,
        mime_type=file.content_type or "",
    )
    return result


@app.get("/health", tags=["health"])
async def health():
    from db.connection import get_db_pool
    db_ok = False
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        pass
    return {"status": "ok", "db": db_ok, "version": "4.0.0"}


@app.get("/api/tools", tags=["system"])
async def list_tools():
    """Meta-endpoint: list all registered tools with their metadata."""
    return [
        {
            "name": m.name,
            "description": m.description,
            "integration": m.integration,
            "method": m.method,
            "path": m.path,
            "tags": m.tags,
            "cache_ttl": m.cache_ttl,
            "idempotent": m.idempotent,
        }
        for m in registry.list_tools()
    ]
