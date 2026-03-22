"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

const SERVICE_META: Record<string, { icon: string; label: string; color: string }> = {
  slack: { icon: "💬", label: "Slack", color: "text-[#E01E5A]" },
  github: { icon: "🐙", label: "GitHub", color: "text-[#8B5CF6]" },
  gmail: { icon: "📧", label: "Gmail", color: "text-[#EA4335]" },
  gmeet: { icon: "📹", label: "Google Meet", color: "text-[#00897B]" },
  jira: { icon: "📋", label: "Jira", color: "text-[#0052CC]" },
}

interface SubAgentCardProps {
  agent: string
  task: string
  status: "running" | "success" | "error"
  result?: string
}

export function SubAgentCard({ agent, task, status, result }: SubAgentCardProps) {
  const [expanded, setExpanded] = useState(status === "running")

  const meta = SERVICE_META[agent] || { icon: "🤖", label: agent, color: "text-primary" }
  const isRunning = status === "running"
  const isError = status === "error"

  return (
    <div
      className={cn(
        "my-2 rounded-xl border transition-all duration-300 overflow-hidden",
        isRunning && "border-blue-400/50 bg-blue-500/5 dark:border-blue-500/30 dark:bg-blue-500/5",
        status === "success" && "border-green-400/30 bg-green-500/5 dark:border-green-500/20 dark:bg-green-500/5",
        isError && "border-red-400/30 bg-red-500/5 dark:border-red-500/20 dark:bg-red-500/5",
      )}
    >
      {/* Header */}
      <button
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm"
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Status icon */}
        {isRunning ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />
        ) : isError ? (
          <XCircle className="h-4 w-4 shrink-0 text-red-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
        )}

        {/* Service icon + label */}
        <span className="text-base">{meta.icon}</span>
        <span className={cn("font-medium", meta.color)}>
          {isRunning ? `Delegating to ${meta.label} Agent` : `${meta.label} Agent`}
        </span>

        {/* Running shimmer */}
        {isRunning && (
          <span className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            working...
          </span>
        )}

        {/* Expand/collapse chevron */}
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </button>

      {/* Expandable content */}
      <div
        className={cn(
          "grid transition-all duration-300 ease-in-out",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-inherit px-3.5 pb-3 pt-2 text-sm">
            {/* Task description */}
            <div className="mb-2 text-muted-foreground">
              <span className="font-medium text-foreground/70">Task:</span>{" "}
              {task}
            </div>

            {/* Result */}
            {result && (
              <div className="rounded-lg bg-background/50 p-2.5 text-xs text-foreground/80">
                <span className="font-medium text-foreground/70">
                  {isError ? "Error:" : "Result:"}
                </span>{" "}
                <span className={isError ? "text-red-500" : ""}>
                  {result.length > 500 ? result.slice(0, 500) + "..." : result}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
