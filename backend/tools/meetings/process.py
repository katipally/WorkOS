"""
Meeting processing pipeline:
1. Transcribe audio/video files using Faster-Whisper
2. Parse text transcripts
3. Chunk and embed for RAG
4. Extract summary using meeting_summary_model
5. Extract action items using meeting_actions_model
"""

from __future__ import annotations

import json
import logging
import re
import uuid

from langchain_core.messages import HumanMessage, SystemMessage

from db.connection import get_pool
from services.ai_service import ainvoke_chat
from services.rag_service import ingest_document, chunk_text
from services.embedding_service import embed_texts
from services.transcription_service import transcribe_file, is_audio_video, is_transcript

log = logging.getLogger(__name__)

SUMMARY_PROMPT = """You are a meeting notes expert. Given the following meeting transcript, produce a clear, structured summary.

Include:
- **Meeting Overview**: One paragraph summarizing what was discussed
- **Key Discussion Points**: Bullet points of the main topics
- **Decisions Made**: Any decisions that were agreed upon
- **Open Questions**: Unresolved topics or questions

Transcript:
{transcript}

Write the summary in Markdown format."""

ACTION_ITEMS_PROMPT = """You are a meeting notes expert. Given the following meeting transcript, extract all action items.

For each action item, extract:
- "text": Description of the action item
- "assignee": Person responsible (or null if unclear)
- "due_date": Due date if mentioned (or null)
- "completed": false

Return ONLY a valid JSON array of objects with those fields. No other text.

Transcript:
{transcript}"""


async def process_meeting_pipeline(meeting_id: str) -> None:
    """Full meeting processing pipeline."""
    pool = get_pool()
    mid = uuid.UUID(meeting_id)

    try:
        # Update status
        await pool.execute(
            "UPDATE meetings SET status = 'processing', updated_at = NOW() WHERE id = $1", mid
        )

        # Get all files for this meeting
        files = await pool.fetch(
            "SELECT * FROM meeting_files WHERE meeting_id = $1 ORDER BY created_at", mid
        )

        if not files:
            await pool.execute(
                "UPDATE meetings SET status = 'error', error = 'No files uploaded', updated_at = NOW() WHERE id = $1",
                mid,
            )
            return

        # Step 1: Transcribe / read all files
        full_transcript = ""

        for f in files:
            filepath = f["filepath"]
            filename = f["filename"]
            file_id = f["id"]

            try:
                if is_audio_video(filename):
                    log.info("Transcribing audio/video: %s", filename)
                    await pool.execute(
                        "UPDATE meeting_files SET status = 'processing' WHERE id = $1", file_id
                    )
                    text = await transcribe_file(filepath)
                    await pool.execute(
                        "UPDATE meeting_files SET status = 'ready', transcription = $2 WHERE id = $1",
                        file_id, text,
                    )
                    full_transcript += f"\n\n[Transcription of {filename}]\n{text}"

                elif is_transcript(filename):
                    with open(filepath, "r", encoding="utf-8", errors="replace") as fh:
                        text = fh.read()
                    await pool.execute(
                        "UPDATE meeting_files SET status = 'ready', transcription = $2 WHERE id = $1",
                        file_id, text,
                    )
                    full_transcript += f"\n\n[Content of {filename}]\n{text}"

                else:
                    # Document file — try parsing
                    from services.rag_service import parse_document

                    text = await parse_document(filepath)
                    await pool.execute(
                        "UPDATE meeting_files SET status = 'ready', transcription = $2 WHERE id = $1",
                        file_id, text,
                    )
                    full_transcript += f"\n\n[Content of {filename}]\n{text}"

            except Exception as e:
                log.exception("Failed to process file %s", filename)
                await pool.execute(
                    "UPDATE meeting_files SET status = 'error' WHERE id = $1", file_id
                )
                full_transcript += f"\n\n[Error processing {filename}: {e}]"

        if not full_transcript.strip():
            await pool.execute(
                "UPDATE meetings SET status = 'error', error = 'No text content extracted', updated_at = NOW() WHERE id = $1",
                mid,
            )
            return

        # Truncate for LLM context window (used in steps 3 & 4)
        transcript_for_llm = full_transcript[:30000]

        # Step 2: Chunk and embed for RAG
        try:
            # Create a document record for this meeting
            doc_row = await pool.fetchrow(
                """INSERT INTO documents (filename, filetype, filepath, source_type, source_id, status)
                   VALUES ($1, 'meeting', '', 'meeting', $2, 'processing') RETURNING id""",
                f"Meeting: {meeting_id}", mid,
            )
            doc_id = str(doc_row["id"])

            chunks = await chunk_text(full_transcript)
            if chunks:
                embeddings = await embed_texts(chunks)
                for i, (chunk_content, embedding) in enumerate(zip(chunks, embeddings)):
                    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
                    await pool.execute(
                        """INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
                           VALUES ($1, $2, $3, $4::vector)""",
                        uuid.UUID(doc_id), i, chunk_content, embedding_str,
                    )
                await pool.execute(
                    "UPDATE documents SET status = 'ready' WHERE id = $1", uuid.UUID(doc_id)
                )
                log.info("Indexed %d chunks for meeting %s", len(chunks), meeting_id)
        except Exception as e:
            log.warning("RAG indexing failed for meeting %s: %s", meeting_id, e)

        # Step 3: Extract summary
        try:
            summary = await ainvoke_chat(
                [
                    SystemMessage(content="You are a meeting notes expert."),
                    HumanMessage(content=SUMMARY_PROMPT.format(transcript=transcript_for_llm)),
                ],
                purpose="meeting_summary",
                temperature=0.3,
            )

            await pool.execute(
                "UPDATE meetings SET summary = $2 WHERE id = $1", mid, summary
            )
            log.info("Generated summary for meeting %s", meeting_id)
        except Exception as e:
            log.exception("Summary extraction failed for meeting %s", meeting_id)
            await pool.execute(
                "UPDATE meetings SET summary = $2 WHERE id = $1",
                mid, f"Summary generation failed: {e}",
            )

        # Step 4: Extract action items
        try:
            action_text = await ainvoke_chat(
                [
                    SystemMessage(content="You extract structured action items from meeting transcripts. Return ONLY valid JSON."),
                    HumanMessage(content=ACTION_ITEMS_PROMPT.format(transcript=transcript_for_llm)),
                ],
                purpose="meeting_actions",
                temperature=0.2,
            )

            # Extract JSON array robustly — greedy: first '[' to last ']'
            json_match = re.search(r"\[.*\]", action_text, re.DOTALL)
            if json_match:
                action_items = json.loads(json_match.group())
            else:
                action_items = []
            if not isinstance(action_items, list):
                action_items = []

            await pool.execute(
                "UPDATE meetings SET action_items = $2 WHERE id = $1",
                mid, json.dumps(action_items),
            )
            log.info("Extracted %d action items for meeting %s", len(action_items), meeting_id)
        except Exception as e:
            log.exception("Action items extraction failed for meeting %s", meeting_id)
            await pool.execute(
                "UPDATE meetings SET action_items = '[]'::jsonb WHERE id = $1", mid
            )

        # Mark as ready
        await pool.execute(
            "UPDATE meetings SET status = 'ready', updated_at = NOW() WHERE id = $1", mid
        )
        log.info("Meeting %s processing complete", meeting_id)

        # Index meeting summary + action items into RAG data_index (non-blocking)
        try:
            from services.rag_service import index_data

            meeting_row = await pool.fetchrow(
                "SELECT title, summary, action_items FROM meetings WHERE id = $1", mid
            )
            if meeting_row and meeting_row["summary"]:
                content = f"Meeting: {meeting_row['title']}\n\n{meeting_row['summary']}"
                actions = json.loads(meeting_row["action_items"]) if meeting_row["action_items"] else []
                if actions:
                    content += "\n\nAction Items:\n"
                    for ai in actions:
                        content += f"- {ai.get('text', '')}"
                        if ai.get("assignee"):
                            content += f" (assigned to {ai['assignee']})"
                        content += "\n"
                await index_data(
                    source_type="meeting",
                    entity_id=meeting_id,
                    title=meeting_row["title"],
                    content=content,
                    metadata={"meeting_id": meeting_id},
                )
                log.info("Indexed meeting %s into RAG data_index", meeting_id)
        except Exception as e:
            log.warning("RAG indexing failed for meeting %s (non-fatal): %s", meeting_id, e)

    except Exception as e:
        log.exception("Meeting processing pipeline failed for %s", meeting_id)
        await pool.execute(
            "UPDATE meetings SET status = 'error', error = $2, updated_at = NOW() WHERE id = $1",
            mid, str(e)[:500],
        )
