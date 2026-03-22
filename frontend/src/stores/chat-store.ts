import { create } from "zustand"
import type {
  AgentStatus,
  Message,
  MessagePart,
  TodoItem,
} from "@/lib/types"
import { api } from "@/lib/api"

// Active AbortControllers keyed by thread ID
const _abortControllers = new Map<string, AbortController>()
// Track the thread ID of the currently streaming request
let _streamingThreadId: string | null = null

// ---------------------------------------------------------------------------
// SSE parser — yields {event, data} from a streaming Response
// ---------------------------------------------------------------------------

interface ParsedSSE {
  event: string
  data: unknown
}

async function* parseSSE(response: Response): AsyncGenerator<ParsedSSE> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("No response body")

  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""
  let currentData = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith("data:")) {
        currentData = line.slice(5).trim()
      } else if (line === "") {
        if (currentEvent && currentData) {
          try {
            yield { event: currentEvent, data: JSON.parse(currentData) }
          } catch {
            // skip malformed events
          }
        }
        currentEvent = ""
        currentData = ""
      }
    }
  }

  if (currentEvent && currentData) {
    try {
      yield { event: currentEvent, data: JSON.parse(currentData) }
    } catch {
      // skip
    }
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface ChatStore {
  messages: Message[]
  status: AgentStatus
  streamingParts: MessagePart[]
  error: string | null

  loadMessages: (threadId: string) => Promise<void>
  sendMessage: (
    message: string,
    threadId?: string,
    model?: string
  ) => Promise<string | null>
  cancelChat: (threadId?: string) => Promise<void>
  approveToolCall: (
    threadId: string,
    decision: "approve" | "reject"
  ) => Promise<void>
  regenerateLastMessage: (threadId: string, model?: string) => Promise<string | null>
  editAndResend: (
    messageId: string,
    newText: string,
    threadId: string,
    model?: string,
  ) => Promise<string | null>
  clearChat: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  status: "idle",
  streamingParts: [],
  error: null,

  loadMessages: async (threadId) => {
    try {
      const messages = await api.getMessages(threadId)
      set({ messages, error: null })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  sendMessage: async (message, threadId, model) => {
    const userMsg: Message = {
      id: `temp-${Date.now()}`,
      thread_id: threadId || "",
      role: "user",
      parts: [{ type: "text", content: message }],
      created_at: new Date().toISOString(),
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      status: "reasoning",
      streamingParts: [],
      error: null,
    }))

    let responseThreadId = threadId || ""

    try {
      const abortController = new AbortController()
      const response = await api.chatStream(message, threadId, model, abortController.signal)
      if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

      responseThreadId = response.headers.get("X-Thread-Id") || threadId || ""
      _streamingThreadId = responseThreadId || null
      if (responseThreadId) _abortControllers.set(responseThreadId, abortController)

      if (responseThreadId && !threadId) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === userMsg.id ? { ...m, thread_id: responseThreadId } : m
          ),
        }))
      }

      await processStream(response, responseThreadId, set, get)
      return responseThreadId || null
    } catch (e) {
      if ((e as Error).name === "AbortError") return responseThreadId || null
      set({ status: "error", error: (e as Error).message })
      return null
    } finally {
      if (responseThreadId) _abortControllers.delete(responseThreadId)
      _streamingThreadId = null
    }
  },

  cancelChat: async (threadId) => {
    const cancelId = threadId || _streamingThreadId
    set({ status: "cancelled" })
    if (cancelId) {
      const ctrl = _abortControllers.get(cancelId)
      if (ctrl) {
        ctrl.abort()
        _abortControllers.delete(cancelId)
      }
      try { await api.cancelChat(cancelId) } catch { /* ignored */ }
    }
  },

  approveToolCall: async (threadId, decision) => {
    set({ status: "reasoning", streamingParts: [], error: null })

    try {
      const abortController = new AbortController()
      _streamingThreadId = threadId
      _abortControllers.set(threadId, abortController)

      const response = await api.approveToolCall(threadId, decision, abortController.signal)
      if (!response.ok) throw new Error(`Approve failed: ${response.status}`)

      const responseThreadId = response.headers.get("X-Thread-Id") || threadId
      await processStream(response, responseThreadId, set, get)
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        set({ status: "error", error: (e as Error).message })
      }
    } finally {
      _abortControllers.delete(threadId)
      _streamingThreadId = null
    }
  },

  clearChat: () =>
    set({
      messages: [],
      streamingParts: [],
      status: "idle",
      error: null,
    }),

  regenerateLastMessage: async (threadId, model) => {
    const { messages, sendMessage } = get()
    // Find the last user message
    let lastUserMsg: Message | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserMsg = messages[i]
        break
      }
    }
    if (!lastUserMsg) return null

    const userText = lastUserMsg.parts.find((p) => p.type === "text")
    if (!userText || userText.type !== "text") return null

    // Remove the last assistant message(s) after the last user message
    const lastUserIdx = messages.lastIndexOf(lastUserMsg)
    set({ messages: messages.slice(0, lastUserIdx + 1) })

    // Re-send via the existing stream flow (but skip adding the user msg)
    set((s) => ({
      status: "reasoning",
      streamingParts: [],
      error: null,
    }))

    let responseThreadId = threadId
    try {
      const abortController = new AbortController()
      const response = await api.chatStream(userText.content, threadId, model, abortController.signal)
      if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

      responseThreadId = response.headers.get("X-Thread-Id") || threadId
      _streamingThreadId = responseThreadId || null
      if (responseThreadId) _abortControllers.set(responseThreadId, abortController)

      await processStream(response, responseThreadId, set, get)
      return responseThreadId || null
    } catch (e) {
      if ((e as Error).name === "AbortError") return responseThreadId || null
      set({ status: "error", error: (e as Error).message })
      return null
    } finally {
      if (responseThreadId) _abortControllers.delete(responseThreadId)
      _streamingThreadId = null
    }
  },

  editAndResend: async (messageId, newText, threadId, model) => {
    const { messages } = get()
    // Find the message to edit
    const msgIdx = messages.findIndex((m) => m.id === messageId)
    if (msgIdx < 0) return null

    // Truncate everything after (and including assistant responses after this message)
    // Replace the user message text and keep only messages up to it
    const editedMsg: Message = {
      ...messages[msgIdx],
      parts: [{ type: "text", content: newText }],
    }
    set({ messages: [...messages.slice(0, msgIdx), editedMsg] })

    // Re-send the edited message
    set((s) => ({
      status: "reasoning",
      streamingParts: [],
      error: null,
    }))

    let responseThreadId = threadId
    try {
      const abortController = new AbortController()
      const response = await api.chatStream(newText, threadId, model, abortController.signal)
      if (!response.ok) throw new Error(`Stream failed: ${response.status}`)

      responseThreadId = response.headers.get("X-Thread-Id") || threadId
      _streamingThreadId = responseThreadId || null
      if (responseThreadId) _abortControllers.set(responseThreadId, abortController)

      await processStream(response, responseThreadId, set, get)
      return responseThreadId || null
    } catch (e) {
      if ((e as Error).name === "AbortError") return responseThreadId || null
      set({ status: "error", error: (e as Error).message })
      return null
    } finally {
      if (responseThreadId) _abortControllers.delete(responseThreadId)
      _streamingThreadId = null
    }
  },
}))

// ---------------------------------------------------------------------------
// Stream processor — handles the new SSE protocol
//
// Events: metadata, thinking, text, tool_start, tool_end, todos,
//         step, interrupt, error, end
// ---------------------------------------------------------------------------

async function processStream(
  response: Response,
  threadId: string,
  set: (partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>)) => void,
  get: () => ChatStore,
) {
  let parts: MessagePart[] = []

  // Append content to the last block of the given type, or create a new one
  const appendContent = (type: "text" | "reasoning", content: string) => {
    const last = parts[parts.length - 1]
    if (last && last.type === type) {
      parts = [
        ...parts.slice(0, -1),
        { ...last, content: (last as { content: string }).content + content },
      ]
    } else {
      parts = [...parts, { type, content } as MessagePart]
    }
    set({ streamingParts: [...parts] })
  }

  for await (const { event, data } of parseSSE(response)) {
    if (get().status === "cancelled") break

    switch (event) {
      case "metadata":
        // Stream initialized — nothing to render
        break

      case "thinking": {
        const { content } = data as { content: string }
        appendContent("reasoning", content)
        if (get().status !== "acting") {
          set({ status: "reasoning" })
        }
        break
      }

      case "text": {
        const { content } = data as { content: string }
        appendContent("text", content)
        if (get().status !== "acting") {
          set({ status: "reasoning" })
        }
        break
      }

      case "tool_start": {
        const { id, name, args } = data as {
          id: string
          name: string
          args: Record<string, unknown>
        }
        parts = [
          ...parts,
          { type: "tool_call", id, name, args, status: "running" as const },
        ]
        set({ streamingParts: [...parts], status: "acting" })
        break
      }

      case "tool_end": {
        const { id, result, error } = data as {
          id: string
          result: string
          error?: string
        }
        parts = parts.map((p) => {
          if (p.type === "tool_call" && p.id === id) {
            return {
              ...p,
              status: (error ? "error" : "success") as "error" | "success",
              result: error || result,
            }
          }
          return p
        })
        set({ streamingParts: [...parts], status: "observing" })
        break
      }

      case "todos": {
        const { todos } = data as { todos: TodoItem[] }
        const idx = parts.findIndex((p) => p.type === "todo")
        if (idx >= 0) {
          parts = [
            ...parts.slice(0, idx),
            { type: "todo", todos } as MessagePart,
            ...parts.slice(idx + 1),
          ]
        } else {
          parts = [...parts, { type: "todo", todos } as MessagePart]
        }
        set({ streamingParts: [...parts] })
        break
      }

      case "step":
        // ReAct loop step boundary — currently no visual rendering
        break

      case "interrupt": {
        const interruptData = data as {
          tool_call_id: string
          tool_name: string
          args: Record<string, unknown>
          message: string
        }
        parts = [...parts, { type: "interrupt", ...interruptData } as MessagePart]
        set({ streamingParts: [...parts], status: "waiting_approval" })
        break
      }

      case "sub_agent_start": {
        const { agent, task, tool_id } = data as {
          agent: string
          task: string
          tool_id: string
        }
        parts = [
          ...parts,
          { type: "sub_agent", agent, task, tool_id, status: "running" as const },
        ]
        set({ streamingParts: [...parts], status: "acting" })
        break
      }

      case "sub_agent_end": {
        const { tool_id: saToolId, result: saResult, error: saError } = data as {
          agent: string
          tool_id: string
          result: string
          error?: string
        }
        parts = parts.map((p) => {
          if (p.type === "sub_agent" && p.tool_id === saToolId) {
            return {
              ...p,
              status: (saError ? "error" : "success") as "error" | "success",
              result: saError || saResult,
            }
          }
          return p
        })
        set({ streamingParts: [...parts], status: "observing" })
        break
      }

      case "error": {
        const { message } = data as { message: string }
        parts = [...parts, { type: "error", message } as MessagePart]
        set({ streamingParts: [...parts], status: "error", error: message })
        break
      }

      case "end": {
        const cleanParts = parts.filter(
          (p) =>
            !(p.type === "text" && !(p as { content: string }).content?.trim()) &&
            !(p.type === "reasoning" && !(p as { content: string }).content?.trim())
        )

        if (cleanParts.length > 0) {
          const assistantMsg: Message = {
            id: `msg-${Date.now()}`,
            thread_id: threadId,
            role: "assistant",
            parts: cleanParts,
            created_at: new Date().toISOString(),
          }
          set((s) => ({
            messages: [...s.messages, assistantMsg],
            streamingParts: [],
            status: "done",
          }))
        } else {
          set({ streamingParts: [], status: "done" })
        }
        break
      }
    }
  }
}
