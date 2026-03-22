"use client"

import { memo, useEffect, useState, type FC } from "react"
import {
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  AuiIf,
  useAuiState,
} from "@assistant-ui/react"
import {
  ArrowDown,
  ChevronDown,
  Copy,
  Mic,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Square,
  Code,
  Database,
  Search,
  Pencil,
  Check,
  Download,
} from "lucide-react"
import { MarkdownText } from "@/components/chat/markdown-text"
import { Reasoning, ReasoningGroup } from "@/components/chat/reasoning"
import { ToolFallback } from "@/components/chat/tool-fallback"
import { TodoList } from "@/components/chat/todo-list"
import { ToolApprovalCard } from "@/components/chat/tool-approval-card"
import { SubAgentCard } from "@/components/chat/sub-agent-card"
import { WorkOSSparkle, WorkOSSparkleSmall } from "@/components/icons/workos-sparkle"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { SlashCommandMenu, useSlashCommands } from "@/components/chat/slash-commands"
import { useSettingsStore } from "@/stores/settings-store"
import { useThreadStore } from "@/stores/thread-store"
import { useChatStore } from "@/stores/chat-store"
import { useServicesStore } from "@/stores/services-store"
import { api } from "@/lib/api"
import type { InterruptPart, OllamaModel, TodoItem } from "@/lib/types"
import { cn } from "@/lib/utils"

// ─── Skeleton shimmer ──────────────────────────────────────────

function SkeletonShimmer() {
  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="skeleton-line h-3.5 w-3/4" />
      <div className="skeleton-line h-3.5 w-1/2" />
      <div className="skeleton-line h-3.5 w-2/3" />
    </div>
  )
}

// ─── Suggestion Chip ───────────────────────────────────────────

const SuggestionChip: FC<{ icon: React.ReactNode; prompt: string; children: React.ReactNode }> = ({
  icon,
  prompt,
  children,
}) => (
  <ThreadPrimitive.Suggestion
    prompt={prompt}
    method="replace"
    autoSend
    className="flex items-center justify-center gap-2.5 rounded-full bg-gemini-chip-bg border border-gemini-chip-border px-4 py-2.5 text-sm text-gemini-on-surface-muted shadow-sm transition-all hover:shadow-md hover:bg-secondary active:scale-[0.98] cursor-pointer"
  >
    {icon}
    <span className="truncate">{children}</span>
  </ThreadPrimitive.Suggestion>
)

// ─── Welcome Screen ────────────────────────────────────────────

function WelcomeComposer() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4">
      <Composer />
    </div>
  )
}

function WelcomeScreen() {
  return (
    <div className="flex h-full flex-col justify-center px-4 animate-fade-in">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-1.5 flex items-center gap-3">
          <WorkOSSparkle className="size-6" />
          <p className="text-xl text-gemini-on-surface">Hello there</p>
        </div>
        <p className="mb-8 text-4xl font-light text-gemini-on-surface-muted">
          Where would you like to start?
        </p>
      </div>
      <WelcomeComposer />
      <div className="mx-auto mt-5 flex w-full max-w-3xl flex-wrap justify-center gap-2.5 px-4">
        <SuggestionChip icon={<Sparkles className="size-4" />} prompt="What can you help me with? List your capabilities.">
          What can you help with?
        </SuggestionChip>
        <SuggestionChip icon={<Code className="size-4" />} prompt="Write a Python function that sorts a list of dictionaries by a given key.">
          Write code
        </SuggestionChip>
        <SuggestionChip icon={<Database className="size-4" />} prompt="What tools and services are currently connected? List them with their capabilities.">
          Connected tools
        </SuggestionChip>
        <SuggestionChip icon={<Search className="size-4" />} prompt="Search the web for the latest AI news today.">
          Search the web
        </SuggestionChip>
      </div>
    </div>
  )
}

// ─── User Message ──────────────────────────────────────────────

const actionBtnClass =
  "flex size-8 items-center justify-center rounded-full text-gemini-on-surface-muted transition-colors hover:bg-[var(--gemini-on-surface-muted)]/10"

function formatTime(date: Date | undefined): string {
  if (!date) return ""
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

function MessageTimestamp() {
  const createdAt = useAuiState((s) => s.message.createdAt)
  const time = formatTime(createdAt)
  if (!time) return null
  return (
    <span className="text-[10px] text-muted-foreground opacity-0 transition-opacity duration-200 group-hover/message:opacity-100 select-none tabular-nums">
      {time}
    </span>
  )
}

function CopyButton({ className }: { className?: string }) {
  const isCopied = useAuiState((s) => s.message.isCopied)
  return (
    <ActionBarPrimitive.Copy className={className} title={isCopied ? "Copied!" : "Copy"}>
      {isCopied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </ActionBarPrimitive.Copy>
  )
}

const UserMessage = memo(function UserMessage() {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto mb-4 flex w-full max-w-3xl flex-col animate-fade-in px-4">
      <div className="flex items-center justify-end gap-1">
        {/* Action bar on hover */}
        <ActionBarPrimitive.Root className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-focus-within/message:opacity-100 group-hover/message:opacity-100">
          <CopyButton className={actionBtnClass} />
          <ActionBarPrimitive.Edit className={actionBtnClass} title="Edit">
            <Pencil className="size-3.5" />
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
        {/* Message bubble */}
        <div className="max-w-[85%] rounded-3xl rounded-tr bg-gemini-user-bubble px-4 py-3 text-sm text-gemini-on-surface">
          <MessagePrimitive.Content
            components={{
              Text: ({ text }: { text: string }) => (
                <span className="whitespace-pre-wrap leading-relaxed">{text}</span>
              ),
            }}
          />
        </div>
      </div>
      {/* Timestamp */}
      <div className="flex justify-end pr-1 pt-0.5">
        <MessageTimestamp />
      </div>
    </MessagePrimitive.Root>
  )
})

// ─── User Edit Composer ────────────────────────────────────────

const UserEditComposer = memo(function UserEditComposer() {
  return (
    <MessagePrimitive.Root className="group/message relative mx-auto mb-4 flex w-full max-w-3xl flex-col animate-fade-in px-4">
      <div className="flex justify-end">
        <ComposerPrimitive.Root className="w-full max-w-[85%] rounded-3xl rounded-tr border border-border bg-gemini-user-bubble px-4 py-3">
          <ComposerPrimitive.Input
            autoFocus
            className="w-full resize-none bg-transparent text-sm text-gemini-on-surface outline-none leading-relaxed"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <ComposerPrimitive.Cancel className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors">
              Cancel
            </ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send className="rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
              Save & Resend
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  )
})

// ─── Assistant Message ─────────────────────────────────────────

const AssistantMessage = memo(function AssistantMessage() {
  const isRunning = useAuiState((s) => s.message.status?.type === "running")
  const hasParts = useAuiState((s) => s.message.parts.length > 0)
  const showSkeleton = isRunning && !hasParts

  return (
    <MessagePrimitive.Root className="group/message relative mx-auto mb-4 flex w-full max-w-3xl flex-col animate-fade-in px-4">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="mt-1 shrink-0">
          <WorkOSSparkleSmall className="size-5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-relaxed text-gemini-on-surface">
            {showSkeleton && <SkeletonShimmer />}
            <MessagePrimitive.Content
              components={{
                Text: MarkdownText,
                Reasoning,
                ReasoningGroup,
                tools: { Fallback: ToolFallback },
                data: { Fallback: AssistantData },
              }}
            />
          </div>

          {/* Action bar + timestamp */}
          <div className="mt-1 flex items-center gap-2">
            <ActionBarPrimitive.Root className="-ml-2 flex items-center gap-0.5 opacity-0 transition-opacity duration-300 group-focus-within/message:opacity-100 group-hover/message:opacity-100">
              <ActionBarPrimitive.Reload className={actionBtnClass} title="Regenerate">
                <RefreshCw className="size-3.5" />
              </ActionBarPrimitive.Reload>
              <CopyButton className={actionBtnClass} />
            </ActionBarPrimitive.Root>
            <MessageTimestamp />
          </div>
        </div>
      </div>
    </MessagePrimitive.Root>
  )
})

// ─── Data parts (interrupt, todo, error) ───────────────────────

function AssistantData({ name, data }: { name: string; data: unknown; status: unknown; type: string }) {
  switch (name) {
    case "interrupt": {
      const d = data as {
        tool_call_id: string
        tool_name: string
        args: Record<string, unknown>
        message: string
      }
      const interrupt: InterruptPart = { type: "interrupt", ...d }
      return <ToolApprovalCard interrupt={interrupt} />
    }

    case "todo": {
      const d = data as { todos: TodoItem[] }
      return <TodoList todos={d.todos} />
    }

    case "error": {
      const d = data as { message: string }
      return (
        <div className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive animate-scale-in">
          <p className="font-medium">Error</p>
          <p className="mt-1 text-destructive/80">{d.message}</p>
        </div>
      )
    }

    case "sub_agent": {
      const d = data as {
        agent: string
        task: string
        tool_id: string
        status: "running" | "success" | "error"
        result?: string
      }
      return (
        <SubAgentCard
          agent={d.agent}
          task={d.task}
          status={d.status}
          result={d.result}
        />
      )
    }

    default:
      return null
  }
}

// ─── Composer ──────────────────────────────────────────────────

function Composer() {
  const isEmpty = useAuiState((s) => s.composer.isEmpty)
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const composerText = useAuiState((s) => s.composer.text)
  const model = useSettingsStore((s) => s.settings.ollama_model)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const displayModel = model?.includes(":") ? model.split(":")[0] : model

  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [models, setModels] = useState<OllamaModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)

  // Slash command handlers
  const createThread = useThreadStore((s) => s.createThread)
  const activeThreadId = useThreadStore((s) => s.activeThreadId)
  const clearChat = useChatStore((s) => s.clearChat)

  const slashCommands = useSlashCommands({
    onNewChat: () => createThread(),
    onSwitchModel: () => setModelPickerOpen(true),
    onClearThread: () => clearChat(),
    onExportThread: () => {
      if (activeThreadId) {
        api.exportThread(activeThreadId).then((md) => {
          const blob = new Blob([md], { type: "text/markdown" })
          const url = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = url
          a.download = `thread-${activeThreadId}.md`
          a.click()
          URL.revokeObjectURL(url)
        })
      }
    },
    onShowShortcuts: () => {
      // Dispatch a custom event that page.tsx listens for
      window.dispatchEvent(new CustomEvent("workos:show-shortcuts"))
    },
  })

  // Show slash menu when input starts with "/"
  useEffect(() => {
    setShowSlashMenu(composerText?.startsWith("/") ?? false)
  }, [composerText])

  const handleSlashCommand = (cmd: { action: () => void }) => {
    cmd.action()
    setShowSlashMenu(false)
  }

  const fetchModels = async () => {
    setModelsLoading(true)
    try {
      const m = await api.listModels()
      setModels(m)
    } catch {
      // silent
    } finally {
      setModelsLoading(false)
    }
  }

  useEffect(() => {
    if (modelPickerOpen && models.length === 0) {
      fetchModels()
    }
  }, [modelPickerOpen, models.length])

  return (
    <ComposerPrimitive.Root
      data-empty={isEmpty}
      data-running={isRunning}
      className="group/composer mx-auto flex w-full max-w-3xl flex-col rounded-[28px] bg-gemini-composer-bg p-3 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)] transition-shadow focus-within:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.16)]"
    >
      {/* Text input */}
      <div className="relative">
        <SlashCommandMenu
          inputValue={composerText || ""}
          commands={slashCommands}
          visible={showSlashMenu}
          onSelectCommand={handleSlashCommand}
          onDismiss={() => setShowSlashMenu(false)}
        />
        <div className="max-h-48 w-full overflow-y-auto">
          <ComposerPrimitive.Input
            autoFocus
            placeholder="Ask WorkOS... (type / for commands)"
            className="block min-h-6 w-full resize-none bg-transparent px-3 py-2 text-sm text-gemini-on-surface outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex w-full items-center text-gemini-on-surface-muted">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {/* Model badge + picker */}
          {displayModel && (
            <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs transition-colors duration-150 hover:bg-secondary"
                >
                  <WorkOSSparkleSmall className="size-3" />
                  <span>{displayModel}</span>
                  <ChevronDown className={cn(
                    "size-3 opacity-60 transition-transform duration-200",
                    modelPickerOpen && "rotate-180"
                  )} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-64 p-1">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  Select Model
                </div>
                {modelsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="size-3.5 animate-spin text-muted-foreground" />
                  </div>
                ) : models.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No models found
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto custom-scrollbar">
                    {models.map((m) => {
                      const name = m.name
                      const isActive = model === name
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => {
                            updateSettings({ ollama_model: name })
                            setModelPickerOpen(false)
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150",
                            isActive
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-secondary text-foreground"
                          )}
                        >
                          <WorkOSSparkleSmall className="size-3 shrink-0" />
                          <span className="flex-1 truncate font-mono text-xs">{name}</span>
                          {isActive && <Check className="size-3.5 shrink-0 text-primary" />}
                          {m.size && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {(m.size / 1e9).toFixed(1)}G
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Connected service badges */}
          <ConnectedServiceBadges />
        </div>

        <div className="flex items-center gap-1.5">
          {/* Send / Cancel button container */}
          <div className="relative size-9 shrink-0">
            {/* Send button — shown when has text & not running */}
            <ComposerPrimitive.Send
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full bg-gemini-send text-gemini-send-text transition-all duration-300 ease-out hover:opacity-90",
                "group-data-[empty=true]/composer:scale-0 group-data-[running=true]/composer:scale-0",
                "group-data-[empty=true]/composer:opacity-0 group-data-[running=true]/composer:opacity-0",
              )}
            >
              <SendHorizontal className="size-[18px]" />
            </ComposerPrimitive.Send>

            {/* Cancel button — shown when running */}
            <ComposerPrimitive.Cancel
              className={cn(
                "absolute inset-0 flex items-center justify-center rounded-full bg-gemini-send text-gemini-send-text transition-all duration-300 ease-out hover:opacity-90",
                "group-data-[running=false]/composer:scale-0",
                "group-data-[running=false]/composer:opacity-0",
              )}
            >
              <Square className="size-3.5" fill="currentColor" />
            </ComposerPrimitive.Cancel>
          </div>
        </div>
      </div>
    </ComposerPrimitive.Root>
  )
}

// ─── Connected Service Badges ──────────────────────────────────

const SERVICE_ICON_MAP: Record<string, { icon: string; label: string }> = {
  slack: { icon: "💬", label: "Slack" },
  github: { icon: "🐙", label: "GitHub" },
  gmail: { icon: "📧", label: "Gmail" },
  gmeet: { icon: "📹", label: "Google Meet" },
  jira: { icon: "📋", label: "Jira" },
}

function ConnectedServiceBadges() {
  const services = useServicesStore((s) => s.services)
  const fetchStatus = useServicesStore((s) => s.fetchStatus)

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const connected = services.filter((s) => s.connected)

  if (connected.length === 0) return null

  return (
    <div className="flex items-center gap-1">
      <span className="mx-1 h-3 w-px bg-border/50" />
      {connected.map((svc) => {
        const meta = SERVICE_ICON_MAP[svc.name] || { icon: "🔧", label: svc.display_name }
        return (
          <span
            key={svc.name}
            className="relative flex h-7 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground transition-colors hover:bg-secondary"
            title={`${meta.label} connected (${svc.tools_count} tools)`}
          >
            <span className="text-xs">{meta.icon}</span>
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-green-500 border border-background" />
          </span>
        )
      })}
    </div>
  )
}

// ─── Main Thread Component ─────────────────────────────────────

export function Thread() {
  return (
    <ThreadPrimitive.Root
      className="flex h-full flex-col items-stretch bg-background"
      style={{ ["--thread-max-width" as string]: "48rem" }}
    >
      {/* Empty state: welcome screen */}
      <ThreadPrimitive.Empty>
        <WelcomeScreen />
      </ThreadPrimitive.Empty>

      {/* Conversation view */}
      <AuiIf condition={(s) => !s.thread.isEmpty}>
        <ThreadPrimitive.Viewport className="flex flex-1 flex-col overflow-y-auto custom-scrollbar scroll-smooth pt-8 pb-4">
          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              UserEditComposer,
              AssistantMessage,
            }}
          />
        </ThreadPrimitive.Viewport>

        {/* Bottom area: scroll-to-bottom + composer */}
        <div className="relative shrink-0 space-y-2 px-4 pb-4">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card p-2.5 shadow-lg transition-all hover:shadow-xl hover:bg-secondary disabled:invisible">
              <ArrowDown className="size-4" />
            </button>
          </ThreadPrimitive.ScrollToBottom>
          <Composer />
          <p className="text-center text-[11px] text-muted-foreground">
            WorkOS may produce inaccurate information. Verify important details.
          </p>
        </div>
      </AuiIf>
    </ThreadPrimitive.Root>
  )
}
