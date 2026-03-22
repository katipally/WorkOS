"""Tests for the ThinkingParser — streaming <think> block extraction."""

import pytest

from workos.agent.thinking import ContentType, ThinkingParser, is_thinking_model


# ---------------------------------------------------------------------------
# Model detection
# ---------------------------------------------------------------------------


def test_is_thinking_model_positive():
    assert is_thinking_model("deepseek-r1:latest")
    assert is_thinking_model("qwq:32b")
    assert is_thinking_model("qwen3:8b")
    assert is_thinking_model("DeepSeek-R1-Distill-Qwen-14B")


def test_is_thinking_model_negative():
    assert not is_thinking_model("llama3.1:latest")
    assert not is_thinking_model("mistral:7b")
    assert not is_thinking_model("gemma2:9b")


# ---------------------------------------------------------------------------
# Parser — non-thinking model (passthrough)
# ---------------------------------------------------------------------------


def test_non_thinking_model_passes_through():
    p = ThinkingParser("llama3.1:latest")
    blocks = p.feed("<think>hello</think>world")
    assert len(blocks) == 1
    assert blocks[0].type == ContentType.TEXT
    assert blocks[0].content == "<think>hello</think>world"


# ---------------------------------------------------------------------------
# Parser — thinking model
# ---------------------------------------------------------------------------


def test_simple_think_block():
    p = ThinkingParser("deepseek-r1:latest")
    blocks = p.feed("<think>reasoning</think>answer")
    assert len(blocks) == 2
    assert blocks[0].type == ContentType.REASONING
    assert blocks[0].content == "reasoning"
    assert blocks[1].type == ContentType.TEXT
    assert blocks[1].content == "answer"


def test_streaming_chunks():
    """Simulate token-by-token streaming across think boundaries."""
    p = ThinkingParser("deepseek-r1:latest")

    # Partial opening tag + reasoning content
    b1 = p.feed("<think>I need to")
    assert len(b1) == 1
    assert b1[0].type == ContentType.REASONING
    assert b1[0].content == "I need to"

    # More reasoning + closing tag + answer
    b2 = p.feed(" analyze</think>Here is")
    assert len(b2) == 2
    assert b2[0].type == ContentType.REASONING
    assert b2[0].content == " analyze"
    assert b2[1].type == ContentType.TEXT
    assert b2[1].content == "Here is"

    # More answer text
    b3 = p.feed(" my answer")
    assert len(b3) == 1
    assert b3[0].type == ContentType.TEXT
    assert b3[0].content == " my answer"

    # Flush
    remaining = p.flush()
    assert remaining == []


def test_unterminated_think_block():
    """Think block that never closes emits reasoning during feed."""
    p = ThinkingParser("deepseek-r1:latest")
    blocks = p.feed("<think>still thinking...")
    assert blocks[0].type == ContentType.REASONING
    assert "still thinking" in blocks[0].content

    # Buffer is empty since content was emitted during feed
    remaining = p.flush()
    assert remaining == []


def test_text_before_think():
    p = ThinkingParser("deepseek-r1:latest")
    blocks = p.feed("prefix<think>inner</think>suffix")
    types = [b.type for b in blocks]
    assert ContentType.TEXT in types
    assert ContentType.REASONING in types


def test_empty_input():
    p = ThinkingParser("deepseek-r1:latest")
    blocks = p.feed("")
    assert blocks == []


def test_flush_with_remaining_text():
    p = ThinkingParser("deepseek-r1:latest")
    blocks = p.feed("hello")
    # Content emitted during feed, not during flush
    assert len(blocks) == 1
    assert blocks[0].type == ContentType.TEXT
    assert blocks[0].content == "hello"
    remaining = p.flush()
    assert remaining == []
