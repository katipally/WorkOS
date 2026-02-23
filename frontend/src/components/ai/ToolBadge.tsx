import { memo } from "react";
import { cn } from "@/lib/utils";
import { Wrench } from "lucide-react";

interface ToolBadgeProps {
  toolName: string;
  className?: string;
}

const TOOL_COLORS: Record<string, { bg: string; text: string }> = {
  slack: { bg: "bg-emerald-500/10 dark:bg-emerald-500/15", text: "text-emerald-600 dark:text-emerald-400" },
  github: { bg: "bg-blue-500/10 dark:bg-blue-500/15", text: "text-blue-600 dark:text-blue-400" },
  meeting: { bg: "bg-violet-500/10 dark:bg-violet-500/15", text: "text-violet-600 dark:text-violet-400" },
  rag: { bg: "bg-amber-500/10 dark:bg-amber-500/15", text: "text-amber-600 dark:text-amber-400" },
};

function getToolColor(name: string): { bg: string; text: string } {
  const lower = name.toLowerCase();
  for (const [key, colors] of Object.entries(TOOL_COLORS)) {
    if (lower.includes(key)) return colors;
  }
  return { bg: "bg-muted", text: "text-muted-foreground" };
}

export const ToolBadge = memo(function ToolBadge({ toolName, className }: ToolBadgeProps) {
  const colors = getToolColor(toolName);
  const displayName = toolName.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-transparent",
        colors.bg,
        colors.text,
        className,
      )}
    >
      <Wrench className="w-2.5 h-2.5" />
      {displayName}
    </span>
  );
});
