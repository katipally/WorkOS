"use client"

import { memo, useCallback, useRef, useState } from "react"
import {
  CheckCircle2,
  ChevronDownIcon,
  Loader2,
  XCircleIcon,
  Wrench,
} from "lucide-react"
import {
  useScrollLock,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "@/lib/utils"

const ANIMATION_DURATION = 250

// ─── Root ──────────────────────────────────────────────────────

function ToolFallbackRoot({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) lockScroll()
      props.onOpenChange?.(open)
    },
    [lockScroll, props],
  )

  return (
    <CollapsiblePrimitive.Root
      ref={collapsibleRef}
      data-slot="tool-fallback-root"
      className={cn(
        "group/tool aui-tool-fallback-root mb-2 rounded-2xl bg-secondary/40 px-4 py-3",
        className,
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      onOpenChange={handleOpenChange}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Root>
  )
}

// ─── Trigger ───────────────────────────────────────────────────

function ToolFallbackTrigger({
  status,
  toolName,
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  status: "running" | "complete" | "incomplete"
  toolName: string
}) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="tool-fallback-trigger"
      className={cn(
        "aui-tool-fallback-trigger group/trigger flex w-full items-center gap-2.5 py-0.5 text-sm transition-colors text-gemini-on-surface-muted hover:text-gemini-on-surface",
        className,
      )}
      {...props}
    >
      {status === "running" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : status === "complete" ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-chart-2" />
      ) : (
        <XCircleIcon className="size-3.5 shrink-0 text-destructive" />
      )}
      <Wrench className="size-3 shrink-0 opacity-50" />
      <span className="aui-tool-fallback-label relative inline-block leading-none">
        <span className="font-medium">{toolName}</span>
        {status === "running" && (
          <span
            aria-hidden
            className="aui-tool-fallback-shimmer shimmer pointer-events-none absolute inset-0 font-medium motion-reduce:animate-none"
          >
            {toolName}
          </span>
        )}
      </span>
      <ChevronDownIcon
        className={cn(
          "aui-tool-fallback-chevron ml-auto size-3.5 shrink-0",
          "transition-transform duration-200 ease-out",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsiblePrimitive.Trigger>
  )
}

// ─── Content ───────────────────────────────────────────────────

function ToolFallbackContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="tool-fallback-content"
      className={cn(
        "aui-tool-fallback-content overflow-hidden text-sm",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        className,
      )}
      {...props}
    >
      <div className="mt-2 space-y-2">{children}</div>
    </CollapsiblePrimitive.Content>
  )
}

// ─── Assembled component ───────────────────────────────────────

const ToolFallbackImpl: ToolCallMessagePartComponent = ({
  toolName,
  args,
  result,
  status,
}) => {
  const toolStatus =
    status?.type === "running"
      ? "running"
      : status?.type === "complete"
        ? "complete"
        : "incomplete"

  return (
    <ToolFallbackRoot>
      <ToolFallbackTrigger status={toolStatus} toolName={toolName} />
      <ToolFallbackContent>
        {args && Object.keys(args).length > 0 && (
          <div className="aui-tool-fallback-args">
            <span className="text-xs font-medium text-gemini-on-surface-muted">Arguments</span>
            <pre className="mt-1 max-h-40 overflow-auto custom-scrollbar rounded-xl bg-secondary/60 p-3 text-xs text-gemini-on-surface-muted font-mono">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        )}
        {result != null && (
          <div className="aui-tool-fallback-result">
            <span className="text-xs font-medium text-gemini-on-surface-muted">Result</span>
            <pre className="mt-1 max-h-40 overflow-auto custom-scrollbar rounded-xl bg-secondary/60 p-3 text-xs text-gemini-on-surface-muted whitespace-pre-wrap font-mono">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  )
}

export const ToolFallback = memo(ToolFallbackImpl)
ToolFallback.displayName = "ToolFallback"
