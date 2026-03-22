from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, HTTPException

from workos.db.database import get_db
from workos.db.models import MessageOut, ThreadCreate, ThreadOut, ThreadUpdate

router = APIRouter(tags=["threads"])


@router.get("/threads", response_model=list[ThreadOut])
async def list_threads():
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC"
    )
    rows = await cursor.fetchall()
    return [
        ThreadOut(id=r[0], title=r[1], created_at=r[2], updated_at=r[3])
        for r in rows
    ]


@router.post("/threads", response_model=ThreadOut)
async def create_thread(data: ThreadCreate):
    db = await get_db()
    thread_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO threads (id, title) VALUES (?, ?)",
        (thread_id, data.title),
    )
    await db.commit()
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM threads WHERE id = ?",
        (thread_id,),
    )
    row = await cursor.fetchone()
    return ThreadOut(id=row[0], title=row[1], created_at=row[2], updated_at=row[3])


@router.get("/threads/{thread_id}", response_model=ThreadOut)
async def get_thread(thread_id: str):
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, title, created_at, updated_at FROM threads WHERE id = ?",
        (thread_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Thread not found")
    return ThreadOut(id=row[0], title=row[1], created_at=row[2], updated_at=row[3])


@router.get("/threads/{thread_id}/messages", response_model=list[MessageOut])
async def get_thread_messages(thread_id: str):
    db = await get_db()
    cursor = await db.execute(
        "SELECT id, thread_id, role, parts, created_at FROM messages WHERE thread_id = ? ORDER BY created_at",
        (thread_id,),
    )
    rows = await cursor.fetchall()
    return [
        MessageOut(
            id=r[0],
            thread_id=r[1],
            role=r[2],
            parts=json.loads(r[3]),
            created_at=r[4],
        )
        for r in rows
    ]


@router.put("/threads/{thread_id}", response_model=ThreadOut)
async def update_thread(thread_id: str, data: ThreadUpdate):
    db = await get_db()
    await db.execute(
        "UPDATE threads SET title = ?, updated_at = datetime('now') WHERE id = ?",
        (data.title, thread_id),
    )
    await db.commit()
    return await get_thread(thread_id)


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str):
    db = await get_db()
    await db.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
    await db.commit()
    return {"status": "deleted", "id": thread_id}


@router.get("/threads/{thread_id}/export")
async def export_thread(thread_id: str):
    db = await get_db()
    cursor = await db.execute(
        "SELECT title FROM threads WHERE id = ?", (thread_id,)
    )
    thread_row = await cursor.fetchone()
    if not thread_row:
        raise HTTPException(status_code=404, detail="Thread not found")

    cursor = await db.execute(
        "SELECT role, parts, created_at FROM messages WHERE thread_id = ? ORDER BY created_at",
        (thread_id,),
    )
    rows = await cursor.fetchall()

    lines = [f"# {thread_row[0]}\n"]

    for row in rows:
        role = row[0]
        parts = json.loads(row[1])
        created = row[2]
        lines.append(f"\n## {role.title()} — {created}\n")

        for part in parts:
            ptype = part.get("type", "text")
            if ptype == "text":
                lines.append(part.get("content", ""))
            elif ptype == "reasoning":
                lines.append(f"\n<details><summary>Thinking</summary>\n\n{part.get('content', '')}\n\n</details>\n")
            elif ptype == "tool_call":
                name = part.get("name", "unknown")
                status = part.get("status", "")
                args = json.dumps(part.get("args", {}), indent=2)
                result = part.get("result", "")
                lines.append(f"\n**Tool: {name}** ({status})\n```json\n{args}\n```\n")
                if result:
                    lines.append(f"Result:\n```\n{result}\n```\n")
            elif ptype == "error":
                lines.append(f"\n> **Error:** {part.get('message', '')}\n")
            elif ptype == "todo":
                todos = part.get("todos", [])
                if todos:
                    lines.append("\n**Todo List:**\n")
                    for t in todos:
                        icon = {"pending": "⬜", "in_progress": "🔄", "done": "✅"}.get(t.get("status", "pending"), "⬜")
                        lines.append(f"- {icon} {t.get('title', 'Untitled')}")
                    lines.append("")

    from fastapi.responses import PlainTextResponse

    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{thread_row[0]}.md"'},
    )
