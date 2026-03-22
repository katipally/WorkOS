import pytest
from httpx import ASGITransport, AsyncClient

# Set env vars before importing the app
import os
os.environ["WORKOS_DATABASE_PATH"] = ":memory:"
os.environ["WORKOS_OLLAMA_URL"] = "http://localhost:11434"

from workos.main import app
from workos.db.database import init_db, close_db


@pytest.fixture
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await close_db()


@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_list_threads_empty(client):
    resp = await client.get("/api/threads")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_create_and_get_thread(client):
    # Create
    resp = await client.post("/api/threads", json={"title": "Test Chat"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Chat"
    thread_id = data["id"]

    # Get
    resp = await client.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == thread_id

    # List
    resp = await client.get("/api/threads")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


@pytest.mark.asyncio
async def test_delete_thread(client):
    resp = await client.post("/api/threads", json={"title": "To Delete"})
    thread_id = resp.json()["id"]

    resp = await client.delete(f"/api/threads/{thread_id}")
    assert resp.status_code == 200

    resp = await client.get(f"/api/threads/{thread_id}")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_settings(client):
    resp = await client.get("/api/settings")
    assert resp.status_code == 200

    resp = await client.put("/api/settings", json={"max_steps": 10})
    assert resp.status_code == 200
    assert resp.json()["max_steps"] == 10


@pytest.mark.asyncio
async def test_mcp_servers_empty(client):
    resp = await client.get("/api/mcp-servers")
    assert resp.status_code == 200
    assert resp.json() == []
