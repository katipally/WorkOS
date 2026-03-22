"use client"

import { useRef, useState, useCallback, useMemo } from "react"
import {
  Plus,
  MessageSquare,
  Trash2,
  Settings,
  PanelLeftClose,
  Check,
  X,
  Search,
} from "lucide-react"
import { WorkOSSparkle } from "@/components/icons/workos-sparkle"
import { useThreadStore } from "@/stores/thread-store"
import { useChatStore } from "@/stores/chat-store"
import { cn } from "@/lib/utils"
import type { Thread } from "@/lib/types"

interface SidebarProps {
  open: boolean
  onToggle: () => void
  onOpenSettings: () => void
  onSelectThread?: () => void
}

function groupThreadsByDate(threads: Thread[]): { label: string; threads: Thread[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  const monthAgo = new Date(today.getTime() - 30 * 86400000)

  const groups: Record<string, Thread[]> = {}
  const order = ["Today", "Yesterday", "This Week", "This Month", "Older"]

  for (const thread of threads) {
    const d = new Date(thread.updated_at || thread.created_at)
    let label: string
    if (d >= today) label = "Today"
    else if (d >= yesterday) label = "Yesterday"
    else if (d >= weekAgo) label = "This Week"
    else if (d >= monthAgo) label = "This Month"
    else label = "Older"

    if (!groups[label]) groups[label] = []
    groups[label].push(thread)
  }

  return order.filter((l) => groups[l]?.length).map((l) => ({ label: l, threads: groups[l] }))
}

export function Sidebar({ open: _open, onToggle, onOpenSettings, onSelectThread }: SidebarProps) {
  const { threads, activeThreadId, setActiveThread, deleteThread, updateThread } =
    useThreadStore()
  const { loadMessages, clearChat } = useChatStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const [searchQuery, setSearchQuery] = useState("")

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads
    const q = searchQuery.toLowerCase()
    return threads.filter((t) => t.title.toLowerCase().includes(q))
  }, [threads, searchQuery])

  const dateGroups = useMemo(() => groupThreadsByDate(filteredThreads), [filteredThreads])

  const handleStartEdit = useCallback((thread: { id: string; title: string }) => {
    setEditingId(thread.id)
    setEditTitle(thread.title)
    setTimeout(() => editInputRef.current?.select(), 0)
  }, [])

  const handleSaveEdit = useCallback(async () => {
    if (editingId && editTitle.trim()) {
      await updateThread(editingId, editTitle.trim())
    }
    setEditingId(null)
  }, [editingId, editTitle, updateThread])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
  }, [])

  const handleSelectThread = async (id: string) => {
    setActiveThread(id)
    await loadMessages(id)
    onSelectThread?.()
  }

  const handleNewChat = async () => {
    setActiveThread(null)
    clearChat()
    onSelectThread?.()
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteThread(id)
    if (activeThreadId === id) {
      clearChat()
    }
  }

  return (
    <aside className="flex h-full w-[260px] min-w-[260px] flex-col bg-sidebar">
      {/* Header */}
      <div className="shrink-0 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WorkOSSparkle className="size-5" />
            <h2 className="text-sm font-semibold text-sidebar-foreground">WorkOS</h2>
          </div>
          <div className="flex gap-0.5">
            <button
              onClick={handleNewChat}
              className="flex size-8 items-center justify-center rounded-full text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50"
              title="New Chat"
            >
              <Plus className="size-4" />
            </button>
            <button
              onClick={onToggle}
              className="flex size-8 items-center justify-center rounded-full text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/50"
              title="Close Sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="shrink-0 px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/40" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats…"
            className="w-full rounded-full border-0 bg-sidebar-accent/40 py-2 pl-8 pr-3 text-xs text-sidebar-foreground outline-none placeholder:text-sidebar-foreground/40 focus:bg-sidebar-accent/60 focus:ring-1 focus:ring-sidebar-ring/30"
          />
        </div>
      </div>

      {/* Thread list */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-2 py-1">
          {filteredThreads.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-sidebar-foreground/40">
              {searchQuery ? "No matching chats" : "No conversations yet"}
            </p>
          )}
          {dateGroups.map((group) => (
            <div key={group.label} className="mb-1">
              <div className="px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/40">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.threads.map((thread) => (
                  <div key={thread.id}>
                    {editingId === thread.id ? (
                      <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                        <input
                          ref={editInputRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit()
                            if (e.key === "Escape") handleCancelEdit()
                          }}
                          onBlur={handleSaveEdit}
                          className="flex-1 rounded-lg bg-sidebar-accent/60 px-2 py-1 text-sm text-sidebar-foreground outline-none focus:ring-1 focus:ring-sidebar-ring/30"
                          autoFocus
                        />
                        <button onClick={handleSaveEdit} className="p-0.5 text-sidebar-foreground/60 hover:text-sidebar-foreground">
                          <Check className="size-3.5" />
                        </button>
                        <button onClick={handleCancelEdit} className="p-0.5 text-sidebar-foreground/60 hover:text-sidebar-foreground">
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectThread(thread.id)}
                        onDoubleClick={() => handleStartEdit(thread)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            handleSelectThread(thread.id)
                          }
                        }}
                        className={cn(
                          "group flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm cursor-pointer",
                          "transition-colors duration-200 ease-out",
                          activeThreadId === thread.id
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40"
                        )}
                      >
                        <MessageSquare className="size-3.5 shrink-0 opacity-60" />
                        <span className="flex-1 truncate">{thread.title}</span>
                        <button
                          onClick={(e) => handleDelete(e, thread.id)}
                          className="shrink-0 flex items-center justify-center size-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-destructive/10"
                        >
                          <Trash2 className="size-3 text-sidebar-foreground/60 hover:text-destructive" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-sidebar-border p-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/40"
        >
          <Settings className="size-4 opacity-60" />
          Settings
        </button>
      </div>
    </aside>
  )
}
