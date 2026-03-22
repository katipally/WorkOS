"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { ChevronDownIcon, Sparkles } from "lucide-react"
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent,
} from "@assistant-ui/react"
import { MarkdownText } from "@/components/chat/markdown-text"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"
import { cn } from "@/lib/utils"

const ANIMATION_DURATION = 250

// ─── Root ──────────────────────────────────────────────────────

type ReasoningRootProps = Omit<
  React.ComponentProps<typeof CollapsiblePrimitive.Root>,
  "open" | "onOpenChange"
> & {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
}

function ReasoningRoot({
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION)

  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) lockScroll()
      if (!isControlled) setUncontrolledOpen(open)
      controlledOnOpenChange?.(open)
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  )

  return (
    <CollapsiblePrimitive.Root
      ref={collapsibleRef}
      data-slot="reasoning-root"
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "group/reasoning-root aui-reasoning-root mb-3 w-full rounded-2xl bg-secondary/50 px-4 py-3",
        className,
      )}
      style={{ "--animation-duration": `${ANIMATION_DURATION}ms` } as React.CSSProperties}
      {...props}
    >
      {children}
    </CollapsiblePrimitive.Root>
  )
}

// ─── Trigger ───────────────────────────────────────────────────

function ReasoningTrigger({
  active,
  duration,
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger> & {
  active?: boolean
  duration?: number
}) {
  const durationText = duration ? ` · ${duration}s` : ""

  return (
    <CollapsiblePrimitive.Trigger
      data-slot="reasoning-trigger"
      className={cn(
        "aui-reasoning-trigger group/trigger flex max-w-[75%] items-center gap-2 py-0.5 text-gemini-on-surface-muted text-sm transition-colors hover:text-gemini-on-surface",
        className,
      )}
      {...props}
    >
      <Sparkles className={cn(
        "aui-reasoning-trigger-icon size-3.5 shrink-0",
        active && "animate-pulse-ring text-primary",
      )} />
      <span className="aui-reasoning-trigger-label-wrapper relative inline-block leading-none">
        <span className="font-medium">Thinking{durationText}</span>
        {active && (
          <span
            aria-hidden
            className="aui-reasoning-trigger-shimmer shimmer pointer-events-none absolute inset-0 font-medium motion-reduce:animate-none"
          >
            Thinking{durationText}
          </span>
        )}
      </span>
      <ChevronDownIcon
        className={cn(
          "aui-reasoning-trigger-chevron mt-0.5 size-3.5 shrink-0",
          "transition-transform duration-200 ease-out",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsiblePrimitive.Trigger>
  )
}

// ─── Content ───────────────────────────────────────────────────

function ReasoningContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="reasoning-content"
      className={cn(
        "aui-reasoning-content relative overflow-hidden text-gemini-on-surface-muted text-sm outline-none",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        className,
      )}
      {...props}
    >
      {children}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-secondary/50 to-transparent" />
    </CollapsiblePrimitive.Content>
  )
}

// ─── Text container ────────────────────────────────────────────

function ReasoningText({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="reasoning-text"
      className={cn(
        "aui-reasoning-text relative z-0 max-h-64 overflow-y-auto custom-scrollbar pt-2 pb-2 pl-5.5 leading-relaxed",
        className,
      )}
      {...props}
    />
  )
}

// ─── Part renderers ────────────────────────────────────────────

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />

const ReasoningGroupImpl: ReasoningGroupComponent = ({ children, startIndex, endIndex }) => {
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false
    const lastIndex = s.message.parts.length - 1
    if (lastIndex < 0) return false
    const lastType = s.message.parts[lastIndex]?.type
    if (lastType !== "reasoning") return false
    return lastIndex >= startIndex && lastIndex <= endIndex
  })

  const duration = useAuiState((s) => {
    const parts = s.message.parts.slice(startIndex, endIndex + 1)
    const reasoningText = parts
      .filter((p) => p.type === "reasoning")
      .map((p) => (p as { text: string }).text)
      .join("")
    return reasoningText.length > 0 ? Math.max(1, Math.round(reasoningText.length / 50)) : undefined
  })

  const [isOpen, setIsOpen] = useState(false)
  const wasStreamingRef = useRef(false)

  useEffect(() => {
    if (isReasoningStreaming) {
      // Open when streaming starts
      setIsOpen(true)
      wasStreamingRef.current = true
    } else if (wasStreamingRef.current) {
      // Auto-collapse after streaming ends (small delay for smooth transition)
      const timer = setTimeout(() => setIsOpen(false), 600)
      wasStreamingRef.current = false
      return () => clearTimeout(timer)
    }
  }, [isReasoningStreaming])

  return (
    <ReasoningRoot open={isOpen} onOpenChange={setIsOpen}>
      <ReasoningTrigger active={isReasoningStreaming} duration={duration} />
      <ReasoningContent aria-busy={isReasoningStreaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  )
}

const Reasoning = memo(ReasoningImpl)
Reasoning.displayName = "Reasoning"

const ReasoningGroup = memo(ReasoningGroupImpl)
ReasoningGroup.displayName = "ReasoningGroup"

export { Reasoning, ReasoningGroup }
