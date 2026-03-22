"""Slack service configuration for WorkOS."""

SERVICE_NAME = "Slack"

SERVICE_TOOL_PREFIX = "slack_"

SERVICE_INSTRUCTIONS = """\
### 💬 Slack

You have full access to a connected Slack workspace. Available operations:

**Messaging**: Send messages (`slack_send_message`), read messages \
(`slack_read_messages`), reply to threads (`slack_reply_thread`), \
send DMs (`slack_send_dm`).

**Channels**: List (`slack_list_channels`), create (`slack_create_channel`), \
archive (`slack_archive_channel`), set topics (`slack_set_channel_topic`).

**Search**: Search messages (`slack_search_messages`) — supports Slack search \
operators like `from:@user`, `in:#channel`, `has:link`, `before:2024-01-01`.

**Reactions & Pins**: Add/remove emoji reactions (`slack_add_reaction`, \
`slack_remove_reaction`), pin/unpin messages (`slack_pin_message`, \
`slack_unpin_message`).

**Users & Files**: Get user profiles (`slack_get_user_profile`), \
upload files (`slack_upload_file`).

**Tips**:
- Channel parameters expect channel IDs (e.g., `C01234567`), not names. \
Use `slack_list_channels` first to find the right ID.
- Thread replies need the parent message's `ts` timestamp.
- Search queries support Slack operators: `from:`, `in:`, `has:`, `before:`, `after:`.
- Use Slack markdown formatting: `*bold*`, `_italic_`, `` `code` ``, \
```code block```, `>quote`.
"""

DELEGATION_DESCRIPTION = """\
Delegate a complex Slack task to the specialized Slack agent. \
Use this for multi-step Slack workflows like: \
searching messages then replying to each, \
creating a channel then inviting users and posting a message, \
reading a thread and summarizing it, \
or any task requiring multiple sequential Slack API calls. \
For simple single-tool calls (sending one message, listing channels), \
use the Slack tools directly instead.\
"""
