"use client"

import { Check, X, ShieldAlert } from "lucide-react"
import { useChatStore } from "@/stores/chat-store"
import { useThreadStore } from "@/stores/thread-store"
import type { InterruptPart } from "@/lib/types"

interface ToolApprovalCardProps {
  interrupt: InterruptPart
}

export function ToolApprovalCard({ interrupt }: ToolApprovalCardProps) {
  const approveToolCall = useChatStore((s) => s.approveToolCall)
  const activeThreadId = useThreadStore((s) => s.activeThreadId)

  const handleDecision = async (decision: "approve" | "reject") => {
    if (activeThreadId) {
      await approveToolCall(activeThreadId, decision)
    }
  }

  return (
    <div className="my-3 rounded-2xl border border-amber-500/30 bg-amber-50/80 dark:bg-amber-950/20 p-4 space-y-3 animate-scale-in">
      <div className="flex items-center gap-2.5 text-amber-700 dark:text-amber-400">
        <ShieldAlert className="size-4" />
        <span className="text-sm font-semibold">Tool Approval Required</span>
      </div>
      <div className="text-sm text-gemini-on-surface-muted">
        <p>{interrupt.message}</p>
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span className="text-gemini-on-surface-muted/60">Tool:</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 font-mono font-medium text-gemini-on-surface">
            {interrupt.tool_name}
          </span>
        </div>
        {Object.keys(interrupt.args).length > 0 && (
          <pre className="mt-2 max-h-32 overflow-auto custom-scrollbar rounded-xl bg-secondary/60 p-3 text-xs font-mono">
            {JSON.stringify(interrupt.args, null, 2)}
          </pre>
        )}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => handleDecision("approve")}
          className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 active:scale-[0.97]"
        >
          <Check className="size-3.5" />
          Approve
        </button>
        <button
          onClick={() => handleDecision("reject")}
          className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-gemini-on-surface transition-all hover:bg-secondary active:scale-[0.97]"
        >
          <X className="size-3.5" />
          Reject
        </button>
      </div>
    </div>
  )
}
