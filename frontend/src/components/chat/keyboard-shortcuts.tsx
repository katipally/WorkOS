"use client"

import { useEffect, useCallback, useState } from "react"
import { useThreadStore } from "@/stores/thread-store"
import { useChatStore } from "@/stores/chat-store"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { Keyboard } from "lucide-react"

const shortcuts = [
  { keys: ["⌘", "K"], description: "New chat", section: "Navigation" },
  { keys: ["⌘", "⇧", "⌫"], description: "Delete current thread", section: "Navigation" },
  { keys: ["⌘", "⇧", "C"], description: "Copy last response", section: "Actions" },
  { keys: ["⌘", "⇧", "E"], description: "Export thread as markdown", section: "Actions" },
  { keys: ["⌘", "/"], description: "Show keyboard shortcuts", section: "Help" },
  { keys: ["Esc"], description: "Close dialog / Unfocus", section: "General" },
]

export function useKeyboardShortcuts() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const createThread = useThreadStore((s) => s.createThread)
  const activeThreadId = useThreadStore((s) => s.activeThreadId)
  const deleteThread = useThreadStore((s) => s.deleteThread)
  const setActiveThread = useThreadStore((s) => s.setActiveThread)
  const messages = useChatStore((s) => s.messages)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const shift = e.shiftKey
      const target = e.target as HTMLElement
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable

      // ⌘K — New chat
      if (meta && e.key === "k") {
        e.preventDefault()
        createThread()
        return
      }

      // ⌘/ — Show shortcuts
      if (meta && e.key === "/") {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }

      // ⌘⇧C — Copy last response
      if (meta && shift && e.key === "C") {
        e.preventDefault()
        const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")
        if (lastAssistant) {
          const text = lastAssistant.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as { content: string }).content)
            .join("\n")
          navigator.clipboard.writeText(text)
        }
        return
      }

      // ⌘⇧E — Export thread
      if (meta && shift && e.key === "E") {
        e.preventDefault()
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
        return
      }

      // ⌘⇧Backspace — Delete thread
      if (meta && shift && e.key === "Backspace" && !isInput) {
        e.preventDefault()
        if (activeThreadId) {
          deleteThread(activeThreadId)
          setActiveThread(null)
        }
        return
      }
    },
    [createThread, activeThreadId, deleteThread, setActiveThread, messages],
  )

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Listen for custom event from slash commands
  useEffect(() => {
    const handler = () => setShortcutsOpen(true)
    window.addEventListener("workos:show-shortcuts", handler)
    return () => window.removeEventListener("workos:show-shortcuts", handler)
  }, [])

  return { shortcutsOpen, setShortcutsOpen }
}

// Shortcuts help dialog
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const sections = Array.from(new Set(shortcuts.map((s) => s.section)))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4" />
            Keyboard Shortcuts
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {sections.map((section) => (
            <div key={section}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {section}
              </h3>
              <div className="space-y-1.5">
                {shortcuts
                  .filter((s) => s.section === section)
                  .map((shortcut) => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5"
                    >
                      <span className="text-sm text-foreground">
                        {shortcut.description}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key) => (
                          <kbd
                            key={key}
                            className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
