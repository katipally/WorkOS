import { memo, useCallback, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/prompt-kit/markdown";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types";

interface RichContentProps {
  content: string;
  messageId: string;
}

/**
 * Enhanced markdown renderer with copy-to-clipboard on code blocks,
 * language labels, and export support.
 */
export const RichContent = memo(function RichContent({ content, messageId }: RichContentProps) {
  return (
    <div className="text-sm leading-relaxed max-w-none prose-styles">
      <Markdown id={messageId}>{content}</Markdown>
    </div>
  );
});

/* ─── Chat Export Utilities ──────────────────────────────────────────────── */

export function exportChatAsMarkdown(messages: ChatMessage[], title: string): void {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push(`\nExported on ${new Date().toLocaleString()}\n`);
  lines.push("---\n");

  for (const msg of messages) {
    if (msg.role === "tool") continue;
    const roleLabel = msg.role === "user" ? "**You**" : "**AI Assistant**";
    const time = new Date(msg.created_at).toLocaleTimeString();
    lines.push(`### ${roleLabel} — ${time}\n`);
    lines.push(msg.content || "_No content_");
    lines.push("");

    if (msg.tool_calls?.length) {
      lines.push("**Tool Calls:**");
      for (const tc of msg.tool_calls) {
        lines.push(`- \`${tc.name}\`(${JSON.stringify(tc.args)})`);
      }
      lines.push("");
    }

    if (msg.pinned) {
      lines.push("> 📌 _Pinned to context_\n");
    }
    lines.push("---\n");
  }

  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportChatAsJSON(messages: ChatMessage[], title: string): void {
  const data = {
    title,
    exportedAt: new Date().toISOString(),
    messages: messages.filter((m) => m.role !== "tool").map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.created_at,
      pinned: m.pinned,
      toolCalls: m.tool_calls,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface ExportButtonProps {
  messages: ChatMessage[];
  title: string;
  className?: string;
}

export function ExportButton({ messages, title, className }: ExportButtonProps) {
  const [open, setOpen] = useState(false);

  const handleExportMd = useCallback(() => {
    exportChatAsMarkdown(messages, title);
    setOpen(false);
  }, [messages, title]);

  const handleExportJson = useCallback(() => {
    exportChatAsJSON(messages, title);
    setOpen(false);
  }, [messages, title]);

  if (!messages.length) return null;

  return (
    <div className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <Download className="w-3.5 h-3.5" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden min-w-[140px]">
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-xs text-foreground transition-colors"
            onClick={handleExportMd}
          >
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            Export as Markdown
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent text-xs text-foreground transition-colors"
            onClick={handleExportJson}
          >
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            Export as JSON
          </button>
        </div>
      )}
    </div>
  );
}
