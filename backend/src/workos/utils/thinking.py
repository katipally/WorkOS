from __future__ import annotations

import re


def parse_thinking(text: str) -> tuple[str | None, str]:
    """Parse <think>...</think> tags from model output.

    Returns (thinking_content, clean_text) where clean_text has
    the think tags removed.
    """
    pattern = re.compile(r"<think>(.*?)</think>", re.DOTALL)
    matches = pattern.findall(text)

    if not matches:
        return None, text

    thinking = "\n".join(m.strip() for m in matches)
    clean = pattern.sub("", text).strip()
    return thinking, clean
