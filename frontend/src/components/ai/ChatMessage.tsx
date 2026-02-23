import { memo, useState, useCallback, Component, type ReactNode } from "react";
import { Pin, Copy, Check, Bot, GitBranch, RefreshCw, User, Pencil, X as XIcon, Send, ThumbsUp, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction,
} from "@/components/prompt-kit/message";
import { Loader } from "@/components/prompt-kit/loader";
import { Tool, type ToolPart } from "@/components/prompt-kit/tool";
import { ToolBadge } from "./ToolBadge";
import { RichContent } from "./RichContent";

interface ChatMessageItemProps {
  message: ChatMessage;
  isStreaming?: boolean;
  isLastAssistant?: boolean;
  onPin?: () => void;
  onBranch?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
  toolResults?: Map<string, { output?: Record<string, unknown>; error?: string }>;
}

/* Tiny error boundary so one bad message doesn't crash the whole chat */
class MessageErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="text-xs text-destructive italic px-2 py-1">
          Failed to render message
        </div>
      );
    }
    return this.props.children;
  }
}

export const ChatMessageItem = memo(function ChatMessageItem(props: ChatMessageItemProps) {
  return (
    <MessageErrorBoundary>
      <ChatMessageInner {...props} />
    </MessageErrorBoundary>
  );
});

const ChatMessageInner = memo(function ChatMessageInner({
  message,
  isStreaming,
  isLastAssistant,
  onPin,
  onBranch,
  onRegenerate,
  onEdit,
  isEditing,
  onStartEdit,
  onCancelEdit,
  toolResults,
}: ChatMessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const isUser = message.role === "user";
  const isTool = message.role === "tool";

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  const handleEditSubmit = useCallback(() => {
    if (editText.trim() && onEdit) {
      onEdit(editText.trim());
    }
  }, [editText, onEdit]);

  // Don't render tool result messages directly — they show inside Tool components
  if (isTool) return null;

  /* ── User message: right-aligned bubble with edit support ──────────── */
  if (isUser) {
    // Editing mode
    if (isEditing && onEdit) {
      return (
        <Message className="flex-row-reverse gap-3 items-start">
          <MessageAvatar
            fallback="U"
            className="bg-primary text-primary-foreground border-0 shrink-0"
          >
            <User className="w-4 h-4" />
          </MessageAvatar>
          <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-muted border border-border px-3 py-2 space-y-2">
            <textarea
              className="w-full text-sm bg-transparent resize-none focus:outline-none min-h-[60px] text-foreground"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleEditSubmit();
                }
                if (e.key === "Escape") onCancelEdit?.();
              }}
              autoFocus
            />
            <div className="flex justify-end gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1 text-muted-foreground"
                onClick={onCancelEdit}
              >
                <XIcon className="w-3 h-3" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={handleEditSubmit}
                disabled={!editText.trim() || editText.trim() === message.content}
              >
                <Send className="w-3 h-3" />
                Send
              </Button>
            </div>
          </div>
        </Message>
      );
    }

    return (
      <Message className="flex-row-reverse gap-3 items-start group">
        <MessageAvatar
          fallback="U"
          className="bg-primary text-primary-foreground border-0 shrink-0"
        >
          <User className="w-4 h-4" />
        </MessageAvatar>
        <div className="relative max-w-[85%] rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          {/* Edit button on hover */}
          {onStartEdit && message.id !== "optimistic-user" && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute -left-8 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              onClick={onStartEdit}
            >
              <Pencil className="w-3 h-3" />
            </Button>
          )}
        </div>
      </Message>
    );
  }

  /* ── Assistant message: left-aligned, flat (no bubble) ─────────────── */

  // Build tool parts from message's tool_calls
  const toolParts: ToolPart[] = (message.tool_calls || []).map((tc) => {
    const result = toolResults?.get(tc.id);
    return {
      type: tc.name.replace(/_/g, " "),
      state: result
        ? result.error
          ? "output-error" as const
          : "output-available" as const
        : "input-available" as const,
      input: tc.args,
      output: result?.output as Record<string, unknown> | undefined,
      toolCallId: tc.id,
      errorText: result?.error,
    };
  });

  return (
    <Message className="group items-start">
      <MessageAvatar
        fallback="AI"
        className="bg-card border border-border text-foreground shrink-0"
      >
        <Bot className="w-4 h-4" />
      </MessageAvatar>

      <div className="flex-1 min-w-0 space-y-1">
        <MessageContent
          className="bg-transparent p-0 text-foreground"
          id={message.id}
        >
          {message.content ? (
            <div className="relative">
              <RichContent content={message.content} messageId={message.id} />
              {isStreaming && (
                <span className="inline-flex ml-1 align-middle">
                  <Loader variant="typing" size="sm" />
                </span>
              )}
            </div>
          ) : isStreaming ? (
            <span className="inline-flex">
              <Loader variant="typing" size="sm" />
            </span>
          ) : null}
        </MessageContent>

        {/* Inline tool badges — compact chips showing which tools were used */}
        {toolParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {toolParts.map((tp) => (
              <ToolBadge key={tp.toolCallId} toolName={tp.type} />
            ))}
          </div>
        )}

        {/* Tool calls — collapsible with input/output */}
        {toolParts.length > 0 && (
          <div className="space-y-1">
            {toolParts.map((tp) => (
              <Tool key={tp.toolCallId} toolPart={tp} className="border-border" />
            ))}
          </div>
        )}

        {/* Pinned indicator */}
        {message.pinned && (
          <div className="flex items-center gap-1.5 pt-1">
            <Pin className="w-3 h-3 text-amber-500 dark:text-amber-400" />
            <span className="text-[11px] text-amber-600/80 dark:text-amber-400/80">Pinned to context</span>
          </div>
        )}

        {/* Actions — shown on hover */}
        {!isStreaming && message.id !== "streaming" && (
          <MessageActions className="pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <MessageAction tooltip="Copy response">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
            </MessageAction>

            <MessageAction tooltip="Helpful">
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6", feedback === "up" ? "text-emerald-500" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setFeedback(feedback === "up" ? null : "up")}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </Button>
            </MessageAction>

            <MessageAction tooltip="Not helpful">
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-6 w-6", feedback === "down" ? "text-destructive" : "text-muted-foreground hover:text-foreground")}
                onClick={() => setFeedback(feedback === "down" ? null : "down")}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </Button>
            </MessageAction>

            {onPin && (
              <MessageAction tooltip={message.pinned ? "Unpin" : "Pin to context"}>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6",
                    message.pinned ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={onPin}
                >
                  <Pin className="w-3.5 h-3.5" />
                </Button>
              </MessageAction>
            )}

            {onBranch && (
              <MessageAction tooltip="Fork conversation">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={onBranch}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                </Button>
              </MessageAction>
            )}

            {isLastAssistant && onRegenerate && (
              <MessageAction tooltip="Regenerate">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={onRegenerate}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </Button>
              </MessageAction>
            )}
          </MessageActions>
        )}
      </div>
    </Message>
  );
});
