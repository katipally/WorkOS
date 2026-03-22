from __future__ import annotations

import logging

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


@tool
def web_search(query: str, max_results: int = 5) -> str:
    """Search the web using DuckDuckGo. Use this to find current information about any topic.

    Args:
        query: The search query string.
        max_results: Maximum number of results to return (default 5).
    """
    from ddgs import DDGS

    try:
        ddgs = DDGS()
        results = list(ddgs.text(query, max_results=max_results))

        if not results:
            return "No results found."

        output_parts = []
        for i, r in enumerate(results, 1):
            title = r.get("title", "")
            body = r.get("body", "")
            href = r.get("href", "")
            output_parts.append(f"{i}. **{title}**\n   {body}\n   URL: {href}")

        return "\n\n".join(output_parts)
    except Exception as e:
        logger.exception("DuckDuckGo search failed")
        return f"Search failed: {e}"


builtin_tools = [web_search]
