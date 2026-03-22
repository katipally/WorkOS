import { create } from "zustand"
import type { Thread } from "@/lib/types"
import { api } from "@/lib/api"

interface ThreadStore {
  threads: Thread[]
  activeThreadId: string | null
  loading: boolean
  error: string | null

  fetchThreads: () => Promise<void>
  createThread: (title?: string) => Promise<Thread>
  setActiveThread: (id: string | null) => void
  updateThread: (id: string, title: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
}

export const useThreadStore = create<ThreadStore>((set, get) => ({
  threads: [],
  activeThreadId: null,
  loading: false,
  error: null,

  fetchThreads: async () => {
    set({ loading: true, error: null })
    try {
      const threads = await api.listThreads()
      set({ threads, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  createThread: async (title?: string) => {
    const thread = await api.createThread(title || "New Chat")
    set((s) => ({ threads: [thread, ...s.threads], activeThreadId: thread.id }))
    return thread
  },

  setActiveThread: (id) => set({ activeThreadId: id }),

  updateThread: async (id, title) => {
    await api.updateThread(id, title)
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, title } : t)),
    }))
  },

  deleteThread: async (id) => {
    await api.deleteThread(id)
    const { threads, activeThreadId } = get()
    const remaining = threads.filter((t) => t.id !== id)
    set({
      threads: remaining,
      activeThreadId: activeThreadId === id ? null : activeThreadId,
    })
  },
}))
