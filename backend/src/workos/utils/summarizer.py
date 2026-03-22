from __future__ import annotations

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_ollama import ChatOllama


async def summarize_messages(
    messages: list,
    model_name: str,
    ollama_url: str,
    keep_recent: int = 6,
) -> list:
    """Summarize older messages to reduce context size.

    Keeps the system message and the most recent `keep_recent` messages intact.
    Summarizes everything in between into a single SystemMessage.
    """
    if len(messages) <= keep_recent + 2:
        return messages

    system_msgs = [m for m in messages if isinstance(m, SystemMessage)]
    non_system = [m for m in messages if not isinstance(m, SystemMessage)]

    if len(non_system) <= keep_recent:
        return messages

    old_messages = non_system[:-keep_recent]
    recent_messages = non_system[-keep_recent:]

    conversation_text = "\n".join(
        f"{getattr(m, 'type', 'unknown')}: {m.content if isinstance(m.content, str) else str(m.content)}"
        for m in old_messages
    )

    model = ChatOllama(model=model_name, base_url=ollama_url)
    summary_response = await model.ainvoke(
        [
            SystemMessage(content="Summarize the following conversation concisely, preserving key facts and context:"),
            HumanMessage(content=conversation_text),
        ]
    )

    summary_msg = SystemMessage(
        content=f"[Summary of earlier conversation]\n{summary_response.content}"
    )

    return system_msgs + [summary_msg] + recent_messages
