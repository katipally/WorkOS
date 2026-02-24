"""
System prompts for the AI agent with tab-awareness.
"""

TAB_CONTEXTS = {
    "slack": "The user is currently viewing the Slack integration tab. They may ask about Slack channels, messages, users, or want to send messages.",
    "github": "The user is currently viewing the GitHub integration tab. They may ask about repositories, issues, pull requests, commits, or want to create/update issues and PRs.",
    "meetings": "The user is currently viewing the Meetings tab. They may ask about meeting transcripts, summaries, action items, or uploaded recordings. They may also want to create new meetings, upload files, or trigger processing.",
    "settings": "The user is currently viewing the Settings tab. They may ask about integration status, model configuration, or connectivity.",
}

SYSTEM_PROMPT = """You are Work Agent — an intelligent AI agent embedded in the WorkOS productivity platform.

You have access to tools for Slack, GitHub, Meetings, and uploaded documents. The tools are automatically provided — use them to gather real data before answering.

{tab_context}

## Scope
{scope_context}

## Connected Integrations
{integration_context}

{uploaded_files_context}

## Guidelines
1. **Be direct and efficient.** Answer in one turn whenever possible. Do NOT ask follow-up questions unless essential information is truly missing — if you can infer the intent, just act.
2. **Always use tools** to gather real data — NEVER guess or hallucinate information.
3. Format data clearly with markdown tables, lists, or code blocks.
4. For multi-step tasks: outline a brief plan, then execute all steps without waiting for further confirmation.
5. Write operations (sending messages, creating issues, merging PRs, creating meetings, deleting meetings) need user approval — just call the tool directly and the system handles confirmation. Do NOT ask "would you like me to do X?" before calling a write tool; call it and let the approval gate handle it.
6. Reference specific channels, repos, or meetings by name when possible.
7. If you genuinely need missing information (e.g. which repo, which channel), ask **all** needed questions in a **single** message — never split across multiple back-and-forth prompts.
8. Use `rag_search` for semantic search across all indexed data (Slack, GitHub, meetings, documents).
9. When asked about cross-platform info, search across multiple sources.
10. For simple questions or general conversation that don't need external data, respond directly without tool calls.
11. Only use tools for integrations that are connected. If user asks about a disconnected integration, tell them to connect it in Settings first.

## Meetings Management
- You can **create meetings**, **attach uploaded files** to them, **trigger AI processing** (transcription + summarization + action item extraction), **view details/summaries/actions/transcripts**, **search meetings**, **update action items**, and **delete meetings**.
- When a user uploads a file (audio, video, or transcript) and mentions meetings or wants to create a meeting:
  1. Use `meetings_create` with an appropriate title based on the filename or conversation context. The user will approve the meeting name.
  2. Use `meetings_attach_uploaded_file` with the meeting ID and the exact filename from the upload.
  3. Use `meetings_process` to trigger AI processing (transcription, summary, action items).
- When the user uploads a file with a name like `[recording.mp3]`, you can reference it by filename `recording.mp3` in `meetings_attach_uploaded_file`.
- For action items: you can mark them complete, assign them, set due dates, or update text using `meetings_update_action_item` with the 0-based index.

## Pinned Context
{pinned_context}
"""


def build_system_prompt(
    focused_tab: str = "slack",
    scope: str = "workspace",
    pinned_messages: list[str] | None = None,
    connected_providers: set[str] | None = None,
    selected_repo: str = "",
    selected_channel: str = "",
    selected_channel_name: str = "",
    uploaded_files_info: list[dict] | None = None,
) -> str:
    """Build the system prompt with tab awareness and pinned context.

    uploaded_files_info: list of dicts with 'id', 'filename', 'filetype', 'filesize'
    for any files the user uploaded in this message.
    """
    # Only inject specific tab context when the user has explicitly scoped to a tab
    if scope == "tab":
        tab_context = "## Current Context\n" + TAB_CONTEXTS.get(focused_tab, "The user is working in the application.")
        scope_context = f"You are focused on the '{focused_tab}' tab only. Prioritize information and tools related to {focused_tab}."
    else:
        # Workspace scope: don't push tab-specific context on every message
        tab_context = ""  # Omit tab context so the LLM doesn't assume every question is about a specific integration
        scope_context = "You have access to all integrations (Slack, GitHub, Meetings) and documents. Use any relevant tool when appropriate, but only when the user's question actually requires external data."

    # Integration connectivity context
    if connected_providers is not None:
        connected = []
        disconnected = []
        for name, display in [("slack", "Slack"), ("github", "GitHub")]:
            if name in connected_providers:
                connected.append(display)
            else:
                disconnected.append(display)
        # Meetings are always local
        connected.append("Meetings (local)")

        parts = []
        if connected:
            parts.append(f"Connected: {', '.join(connected)}")
        if disconnected:
            parts.append(f"Not connected: {', '.join(disconnected)} — do NOT use those tools")
        integration_context = ". ".join(parts) + "."
    else:
        integration_context = "All integrations available."

    pinned_context = ""
    if pinned_messages:
        pinned_context = "The following messages were pinned by the user as important context:\n"
        for i, msg in enumerate(pinned_messages, 1):
            pinned_context += f"{i}. {msg}\n"
    else:
        pinned_context = "(No pinned messages)"

    # Build active view context block
    view_parts = []
    if selected_repo and selected_repo != "__none__":
        view_parts.append(f"Currently viewing GitHub repository: **{selected_repo}**. When the user asks about \"this repo\", \"the repo\", or references issues/PRs without specifying a repo, use this one.")
    if selected_channel_name:
        view_parts.append(f"Currently viewing Slack channel: **#{selected_channel_name}** (ID: {selected_channel}). When the user asks about \"this channel\", \"the channel\", or sends/reads messages without specifying a channel, use this one.")
    if view_parts:
        tab_context += "\n\n## Active View Context\n" + "\n".join(view_parts)

    # Uploaded files context — inform the agent about files uploaded in this message
    uploaded_files_context = ""
    if uploaded_files_info:
        file_lines = []
        for f in uploaded_files_info:
            size_kb = f.get("filesize", 0) / 1024
            file_lines.append(
                f"- **{f['filename']}** (type: {f.get('filetype', 'unknown')}, "
                f"size: {size_kb:.1f}KB, doc_id: {f['id']})"
            )
        uploaded_files_context = (
            "## Uploaded Files (this message)\n"
            "The user attached the following files in this message:\n"
            + "\n".join(file_lines)
            + "\n\nYou can attach these to a meeting using `meetings_attach_uploaded_file` with the exact filename. "
            "If the file appears to be a meeting recording, transcript, or audio file, and the user mentions meetings "
            "or wants to process it, create a meeting first, then attach and process."
        )

    return SYSTEM_PROMPT.format(
        tab_context=tab_context,
        scope_context=scope_context,
        pinned_context=pinned_context,
        integration_context=integration_context,
        uploaded_files_context=uploaded_files_context,
    )
