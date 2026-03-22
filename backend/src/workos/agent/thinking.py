"""Thinking/reasoning token parser for Ollama models.

Handles extraction of `<think>...</think>` blocks from streaming AI response
tokens. Models like DeepSeek-R1 and QwQ use these tags to wrap internal
reasoning, which we surface as separate "reasoning" content blocks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum


class ContentType(str, Enum):
    TEXT = "text"
    REASONING = "reasoning"


@dataclass
class ContentBlock:
    """A parsed content block from streaming tokens."""
    type: ContentType
    content: str


# Models known to use <think> tags for reasoning.
# Be precise: "qwen3:Thinking" is a thinking model, "qwen3.5:9b" is NOT.
THINKING_MODELS = re.compile(
    r"(deepseek[-_]?r1|:thinking|qwq)", re.IGNORECASE
)


def is_thinking_model(model_name: str) -> bool:
    """Check if the model is known to emit <think> blocks."""
    return bool(THINKING_MODELS.search(model_name))


class ThinkingParser:
    """Stateful parser for extracting thinking blocks from streamed tokens.

    Tracks whether we're currently inside a <think>...</think> block and
    returns a list of ContentBlocks for each chunk of text received.

    Usage:
        parser = ThinkingParser(model_name="deepseek-r1:latest")
        for chunk_text in token_stream:
            blocks = parser.feed(chunk_text)
            for block in blocks:
                # block.type is "reasoning" or "text"
                emit_sse_event(block)
        # At end, flush any remaining content
        blocks = parser.flush()
    """

    def __init__(self, model_name: str):
        self.model_name = model_name
        self.enabled = is_thinking_model(model_name)
        self._in_thinking = False
        self._buffer = ""

    def feed(self, text: str) -> list[ContentBlock]:
        """Process a chunk of streamed text and return content blocks.

        Returns a list of ContentBlock objects. Each block is either
        TEXT or REASONING. Multiple blocks can be returned if the chunk
        contains a <think>/</think> boundary.
        """
        if not self.enabled or not text:
            return [ContentBlock(type=ContentType.TEXT, content=text)] if text else []

        self._buffer += text
        blocks: list[ContentBlock] = []
        self._parse_buffer(blocks)
        return blocks

    def _parse_buffer(self, blocks: list[ContentBlock]) -> None:
        """Parse the internal buffer, extracting complete blocks."""
        while self._buffer:
            if self._in_thinking:
                # Look for closing </think> tag
                close_idx = self._buffer.find("</think>")
                if close_idx == -1:
                    # Check if buffer might be a partial </think> tag
                    # e.g., "</thi" at the end
                    for i in range(1, min(len("</think>"), len(self._buffer) + 1)):
                        if "</think>"[:i] == self._buffer[-i:]:
                            # Potential partial tag — emit everything before it,
                            # keep partial in buffer
                            safe = self._buffer[: -i]
                            if safe:
                                blocks.append(ContentBlock(type=ContentType.REASONING, content=safe))
                            self._buffer = self._buffer[-i:]
                            return
                    # No partial tag detected, emit all as reasoning
                    blocks.append(ContentBlock(type=ContentType.REASONING, content=self._buffer))
                    self._buffer = ""
                    return
                else:
                    # Found closing tag
                    reasoning_text = self._buffer[:close_idx]
                    if reasoning_text:
                        blocks.append(ContentBlock(type=ContentType.REASONING, content=reasoning_text))
                    self._in_thinking = False
                    self._buffer = self._buffer[close_idx + len("</think>"):]
            else:
                # Look for opening <think> tag
                open_idx = self._buffer.find("<think>")
                if open_idx == -1:
                    # Check for partial <think> tag at the end
                    for i in range(1, min(len("<think>"), len(self._buffer) + 1)):
                        if "<think>"[:i] == self._buffer[-i:]:
                            safe = self._buffer[: -i]
                            if safe:
                                blocks.append(ContentBlock(type=ContentType.TEXT, content=safe))
                            self._buffer = self._buffer[-i:]
                            return
                    # No partial tag, emit all as text
                    blocks.append(ContentBlock(type=ContentType.TEXT, content=self._buffer))
                    self._buffer = ""
                    return
                else:
                    # Found opening tag
                    text_before = self._buffer[:open_idx]
                    if text_before:
                        blocks.append(ContentBlock(type=ContentType.TEXT, content=text_before))
                    self._in_thinking = True
                    self._buffer = self._buffer[open_idx + len("<think>"):]

    def flush(self) -> list[ContentBlock]:
        """Flush any remaining buffered content."""
        blocks: list[ContentBlock] = []
        if self._buffer:
            block_type = ContentType.REASONING if self._in_thinking else ContentType.TEXT
            blocks.append(ContentBlock(type=block_type, content=self._buffer))
            self._buffer = ""
        return blocks
