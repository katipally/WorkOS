"""
Centralized configuration constants for the AI agent.

All magic numbers and tunables live here so they can be found and changed
in one place instead of being scattered across modules.
"""

from __future__ import annotations

# ─── LLM Call ────────────────────────────────────────────────────────────────
LLM_TIMEOUT_SECONDS: int = 90
"""Seconds before an individual LLM invocation is aborted."""

DEFAULT_TEMPERATURE: float = 0.7
"""Fallback temperature when the DB `ai_settings` table has no value."""

# ─── Agent Loop Limits ───────────────────────────────────────────────────────
MAX_TOOL_LOOPS: int = 10
"""Maximum tool‑call → LLM round‑trips before the graph auto‑stops."""

MAX_STREAM_ITERATIONS: int = 50
"""Safety cap on the total (messages + updates) stream items processed in
the SSE event generator. Prevents runaway loops at the router layer."""

APPROVAL_TIMEOUT_SECONDS: int = 120
"""Seconds before a pending‑approval tool execution is timed out."""

# ─── Smart Compaction ────────────────────────────────────────────────────────
COMPACTION_THRESHOLD: int = 20
"""When the conversation has more messages than this, older messages are
summarised to keep the context window manageable."""

COMPACTION_KEEP_RECENT: int = 10
"""Number of most‑recent messages to keep verbatim during compaction."""

COMPACTION_CHAR_LIMIT: int = 200
"""Per‑message character limit when building the compaction summary input."""

COMPACTION_INPUT_CAP: int = 4000
"""Max total characters of old‑message text sent to the summary LLM."""

COMPACTION_TEMPERATURE: float = 0.3
"""Temperature used for the compaction summariser LLM call."""

# ─── RAG / Retrieval ────────────────────────────────────────────────────────
RAG_DEFAULT_TOP_K: int = 6
"""Default number of RAG results when scope is workspace or multi‑mention."""

RAG_TAB_TOP_K: int = 5
"""Default number of RAG results when scope is tab."""

RAG_MIN_SCORE_THRESHOLD: float = 0.25
"""Minimum cosine‑similarity score (0‑1) for a RAG result to be kept.
pgvector always returns top‑K rows regardless of relevance; this filter
drops items whose similarity to the query is too low."""

RAG_RERANK_MIN_SCORE: float = 0.15
"""Minimum FlashRank rerank score — results below this are discarded."""

RAG_MIN_PER_SOURCE: int = 2
"""Minimum results per mentioned source in multi‑source retrieval."""

RAG_CONTEXT_SNIPPET_LEN: int = 500
"""Maximum characters shown per RAG snippet in the system prompt."""

RAG_MAX_SNIPPETS: int = 5
"""Maximum number of RAG snippets injected into the system prompt."""

# ─── Chunking ────────────────────────────────────────────────────────────────
CHUNK_SIZE: int = 1000
"""Character size of each document chunk for embedding."""

CHUNK_OVERLAP: int = 200
"""Overlap between adjacent chunks."""

# ─── Auto‑title ──────────────────────────────────────────────────────────────
AUTO_TITLE_MAX_LENGTH: int = 60
"""Maximum length for an auto‑generated session title."""

# ─── Approval‑gated Tools ───────────────────────────────────────────────────
APPROVAL_REQUIRED_TOOLS: set[str] = {
    # Slack write operations
    "slack_send_message",
    "slack_send_dm",
    "slack_pin_message",
    "slack_schedule_message",
    "slack_edit_message",
    "slack_delete_message",
    # GitHub write operations
    "github_create_issue",
    "github_create_branch",
    "github_submit_pr_review",
    "github_merge_pr",
    "github_create_release",
}

# ─── Reasoning Models ───────────────────────────────────────────────────────
REASONING_MODEL_PREFIXES: tuple[str, ...] = ("o1", "o3", "o4")
"""Model name prefixes whose temperature is clamped to 1 and that do not
support token‑by‑token streaming."""

CHAT_MODEL_PREFIXES: tuple[str, ...] = ("gpt-4", "gpt-3.5", "gpt-5", "o1", "o3", "o4")
"""Prefixes used when filtering OpenAI models in the list‑models endpoint."""

EMBEDDING_MODEL_PREFIXES: tuple[str, ...] = ("text-embedding-",)
"""Prefixes used when filtering OpenAI embedding models."""
