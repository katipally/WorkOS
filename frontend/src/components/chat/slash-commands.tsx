"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  MessageSquarePlus,
  Cpu,
  Trash2,
  Download,
  Keyboard,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface SlashCommand {
  name: string
  description: string
  icon: LucideIcon
  action: () => void
}

interface SlashCommandMenuProps {
  inputValue: string
  onSelectCommand: (command: SlashCommand) => void
  commands: SlashCommand[]
  visible: boolean
  onDismiss: () => void
}

export function useSlashCommands(handlers: {
  onNewChat: () => void
  onSwitchModel: () => void
  onClearThread: () => void
  onExportThread: () => void
  onShowShortcuts: () => void
}) {
  const commands: SlashCommand[] = [
    {
      name: "/new",
      description: "Start a new chat",
      icon: MessageSquarePlus,
      action: handlers.onNewChat,
    },
    {
      name: "/model",
      description: "Switch the active model",
      icon: Cpu,
      action: handlers.onSwitchModel,
    },
    {
      name: "/clear",
      description: "Clear current thread",
      icon: Trash2,
      action: handlers.onClearThread,
    },
    {
      name: "/export",
      description: "Export thread as markdown",
      icon: Download,
      action: handlers.onExportThread,
    },
    {
      name: "/shortcuts",
      description: "Show keyboard shortcuts",
      icon: Keyboard,
      action: handlers.onShowShortcuts,
    },
  ]

  return commands
}

export function SlashCommandMenu({
  inputValue,
  onSelectCommand,
  commands,
  visible,
  onDismiss,
}: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  // Filter commands based on input
  const query = inputValue.startsWith("/") ? inputValue.slice(1).toLowerCase() : ""
  const filtered = commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query),
  )

  // Reset selection when filtered list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || filtered.length === 0) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedIndex((i) => (i + 1) % filtered.length)
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length)
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        onSelectCommand(filtered[selectedIndex])
      } else if (e.key === "Escape") {
        e.preventDefault()
        onDismiss()
      }
    },
    [visible, filtered, selectedIndex, onSelectCommand, onDismiss],
  )

  useEffect(() => {
    if (visible) {
      window.addEventListener("keydown", handleKeyDown, { capture: true })
      return () => window.removeEventListener("keydown", handleKeyDown, { capture: true })
    }
  }, [visible, handleKeyDown])

  if (!visible || filtered.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 z-50 mb-2 w-72 overflow-hidden rounded-xl border border-border bg-popover shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
    >
      <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Commands
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.map((cmd, i) => {
          const Icon = cmd.icon
          return (
            <button
              key={cmd.name}
              type="button"
              onClick={() => onSelectCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                i === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground hover:bg-secondary",
              )}
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <span className="font-mono text-xs font-medium">{cmd.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {cmd.description}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
