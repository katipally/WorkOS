"""
RAG pipeline: ingest documents, chunk, embed, retrieve with reranking.
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Optional

from db.connection import get_pool
from services.embedding_service import embed_texts, embed_query

log = logging.getLogger(__name__)

# ─── FlashRank singleton ─────────────────────────────────────────────────────
_ranker_instance = None


def _get_ranker():
    """Lazily initialize and cache the FlashRank ranker singleton."""
    global _ranker_instance
    if _ranker_instance is None:
        try:
            from flashrank import Ranker
            _ranker_instance = Ranker()
        except Exception as e:
            log.warning("Failed to initialize FlashRank Ranker: %s", e)
    return _ranker_instance


# ─── Chunking ────────────────────────────────────────────────────────────────

async def chunk_text(text: str, chunk_size: int = 1000, chunk_overlap: int = 200) -> list[str]:
    """Split text into semantically coherent chunks."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    return splitter.split_text(text)


# ─── Document parsing ────────────────────────────────────────────────────────

async def parse_document(filepath: str) -> str:
    """Parse document (PDF, DOCX, TXT, MD) to plain text."""
    ext = os.path.splitext(filepath)[1].lower()

    if ext in (".txt", ".md", ".csv"):
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    # For PDF, DOCX, etc. → use docling
    try:
        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(filepath)
        return result.document.export_to_markdown()
    except Exception as e:
        log.warning("Docling parse failed for %s: %s — falling back to raw read", filepath, e)
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            return f.read()


# ─── Ingest pipeline ─────────────────────────────────────────────────────────

async def ingest_document(document_id: str, filepath: str) -> int:
    """
    Full ingest pipeline for a document:
    1. Parse document to text
    2. Chunk text
    3. Embed chunks
    4. Store in pgvector
    Returns number of chunks created.
    """
    pool = get_pool()

    try:
        # Update status
        await pool.execute(
            "UPDATE documents SET status = 'processing' WHERE id = $1",
            uuid.UUID(document_id),
        )

        # Parse
        text = await parse_document(filepath)
        if not text.strip():
            await pool.execute(
                "UPDATE documents SET status = 'error', error = 'Empty document' WHERE id = $1",
                uuid.UUID(document_id),
            )
            return 0

        # Chunk
        chunks = await chunk_text(text)
        if not chunks:
            await pool.execute(
                "UPDATE documents SET status = 'error', error = 'No chunks produced' WHERE id = $1",
                uuid.UUID(document_id),
            )
            return 0

        # Embed
        embeddings = await embed_texts(chunks)

        # Store chunks
        for i, (chunk_text_content, embedding) in enumerate(zip(chunks, embeddings)):
            embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"
            await pool.execute(
                """
                INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
                VALUES ($1, $2, $3, $4::vector)
                """,
                uuid.UUID(document_id),
                i,
                chunk_text_content,
                embedding_str,
            )

        # Mark ready
        await pool.execute(
            "UPDATE documents SET status = 'ready' WHERE id = $1",
            uuid.UUID(document_id),
        )
        log.info("Ingested document %s: %d chunks", document_id, len(chunks))
        return len(chunks)

    except Exception as e:
        log.exception("Failed to ingest document %s", document_id)
        await pool.execute(
            "UPDATE documents SET status = 'error', error = $2 WHERE id = $1",
            uuid.UUID(document_id),
            str(e)[:500],
        )
        return 0


# ─── Index app data ──────────────────────────────────────────────────────────

async def index_data(
    source_type: str,
    entity_id: str,
    title: str,
    content: str,
    metadata: dict | None = None,
) -> None:
    """Index a piece of app data (Slack message, GitHub issue, etc.) for RAG."""
    pool = get_pool()
    embedding = (await embed_texts([content]))[0]
    embedding_str = "[" + ",".join(str(v) for v in embedding) + "]"

    import json

    await pool.execute(
        """
        INSERT INTO data_index (source_type, entity_id, title, content, metadata, embedding)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
        ON CONFLICT (source_type, entity_id) DO UPDATE
        SET title = $3, content = $4, metadata = $5::jsonb, embedding = $6::vector, indexed_at = NOW()
        """,
        source_type,
        entity_id,
        title,
        content,
        json.dumps(metadata or {}),
        embedding_str,
    )


# ─── Retrieval ────────────────────────────────────────────────────────────────

async def search_documents(
    query: str,
    top_k: int = 10,
    source_filter: Optional[str] = None,
) -> list[dict]:
    """
    Hybrid search: pgvector cosine similarity + optional FlashRank reranking.
    Searches both document_chunks and data_index tables.
    """
    pool = get_pool()
    query_embedding = await embed_query(query)
    embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

    # Search document_chunks (filter by source_type if provided)
    if source_filter:
        doc_query = """
            SELECT dc.content, dc.metadata, d.filename,
                   1 - (dc.embedding <=> $1::vector) AS score,
                   'document' AS source
            FROM document_chunks dc
            JOIN documents d ON d.id = dc.document_id
            WHERE d.status = 'ready' AND d.source_type = $3
            ORDER BY dc.embedding <=> $1::vector
            LIMIT $2
        """
        doc_rows = await pool.fetch(doc_query, embedding_str, top_k, source_filter)
    else:
        doc_query = """
            SELECT dc.content, dc.metadata, d.filename,
                   1 - (dc.embedding <=> $1::vector) AS score,
                   'document' AS source
            FROM document_chunks dc
            JOIN documents d ON d.id = dc.document_id
            WHERE d.status = 'ready'
            ORDER BY dc.embedding <=> $1::vector
            LIMIT $2
        """
        doc_rows = await pool.fetch(doc_query, embedding_str, top_k)

    # Search data_index
    data_query = """
        SELECT content, metadata, title, source_type,
               1 - (embedding <=> $1::vector) AS score,
               'index' AS source
        FROM data_index
    """
    data_params: list[Any] = [embedding_str]
    if source_filter:
        data_query += " WHERE source_type = $2"
        data_params.append(source_filter)
    data_query += f" ORDER BY embedding <=> $1::vector LIMIT ${len(data_params) + 1}"
    data_params.append(top_k)
    data_rows = await pool.fetch(data_query, *data_params)

    # Combine results
    results = []
    for row in doc_rows:
        results.append({
            "content": row["content"],
            "score": float(row["score"]),
            "source": "document",
            "filename": row["filename"],
        })
    for row in data_rows:
        results.append({
            "content": row["content"],
            "score": float(row["score"]),
            "source": row["source_type"],
            "title": row["title"],
        })

    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)

    # Optional reranking with FlashRank (uses singleton)
    if results:
        ranker = _get_ranker()
        if ranker is not None:
            try:
                from flashrank import RerankRequest

                passages = [{"id": str(i), "text": r["content"]} for i, r in enumerate(results)]
                rerank_req = RerankRequest(query=query, passages=passages)
                reranked = ranker.rerank(rerank_req)
                reranked_results = []
                for item in reranked:
                    idx = int(item["id"])
                    entry = results[idx].copy()
                    entry["rerank_score"] = item["score"]
                    reranked_results.append(entry)
                results = reranked_results
            except Exception as e:
                log.warning("FlashRank reranking failed: %s — using vector scores", e)

    return results[:top_k]
