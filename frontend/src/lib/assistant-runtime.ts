"use client"

import { useMemo, useRef } from "react"
import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react"
import type { MessageStatus } from "@assistant-ui/react"
import type { ReadonlyJSONObject, ReadonlyJSONValue } from "assistant-stream/utils"
import type { Message, MessagePart } from "@/lib/types"
import { useChatStore } from "@/stores/chat-store"
import { useThreadStore } from "@/stores/thread-store"

/**
 * Convert our MessagePart[] to assistant-ui content parts.
 */
function convertParts(parts: MessagePart[]): ThreadMessageLike["content"] {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "reasoning"; text: string }
    | {
        type: "tool-call"
        toolCallId: string
        toolName: string
        args: ReadonlyJSONObject
        result?: ReadonlyJSONValue
        isError?: boolean
      }
    | { type: "data"; name: string; data: ReadonlyJSONValue }
  > = []

  for (const part of parts) {
    switch (part.type) {
      case "text":
        content.push({ type: "text", text: part.content })
        break

      case "reasoning":
        content.push({ type: "reasoning", text: part.content })
        break

      case "tool_call":
        content.push({
          type: "tool-call",
          toolCallId: part.id || `tc_${Date.now()}`,
          toolName: part.name,
          args: (part.args ?? {}) as ReadonlyJSONObject,
          result:
            part.status === "success" || part.status === "error"
              ? (part.result as ReadonlyJSONValue)
              : undefined,
          isError: part.status === "error" || part.status === "rejected",
        })
        break

      case "interrupt":
        content.push({
          type: "data",
          name: "interrupt",
          data: {
            tool_call_id: part.tool_call_id,
            tool_name: part.tool_name,
            args: part.args,
            message: part.message,
          } as unknown as ReadonlyJSONValue,
        })
        break

      case "todo":
        content.push({
          type: "data",
          name: "todo",
          data: { todos: part.todos } as unknown as ReadonlyJSONValue,
        })
        break

      case "error":
        content.push({
          type: "data",
          name: "error",
          data: { message: part.message } as unknown as ReadonlyJSONValue,
        })
        break

      case "sub_agent":
        content.push({
          type: "data",
          name: "sub_agent",
          data: {
            agent: part.agent,
            task: part.task,
            tool_id: part.tool_id,
            status: part.status,
            result: part.result,
          } as unknown as ReadonlyJSONValue,
        })
        break

      case "step":
        break
    }
  }

  return content
}

function makeStatus(
  isRunning: boolean,
  isLast: boolean,
): MessageStatus {
  if (isRunning && isLast) return { type: "running" }
  return { type: "complete", reason: "stop" }
}

/**
 * Convert our Message[] + streaming state into ThreadMessageLike[]
 */
function toThreadMessages(
  messages: Message[],
  streamingParts: MessagePart[],
  isRunning: boolean,
): ThreadMessageLike[] {
  const result: ThreadMessageLike[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isLast = i === messages.length - 1 && streamingParts.length === 0

    if (msg.role === "assistant") {
      result.push({
        role: "assistant",
        id: msg.id,
        createdAt: new Date(msg.created_at),
        content: convertParts(msg.parts),
        status: makeStatus(isRunning, isLast),
      })
    } else {
      result.push({
        role: msg.role,
        id: msg.id,
        createdAt: new Date(msg.created_at),
        content: convertParts(msg.parts),
      })
    }
  }

  if (isRunning && streamingParts.length > 0) {
    result.push({
      role: "assistant",
      id: "streaming",
      createdAt: new Date(),
      content: convertParts(streamingParts),
      status: { type: "running" },
    })
  }

  return result
}

/**
 * Hook that creates an assistant-ui runtime backed by our Zustand chat store.
 */
export function useWorkOSRuntime() {
  const messages = useChatStore((s) => s.messages)
  const streamingParts = useChatStore((s) => s.streamingParts)
  const status = useChatStore((s) => s.status)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const cancelChat = useChatStore((s) => s.cancelChat)
  const regenerateLastMessage = useChatStore((s) => s.regenerateLastMessage)
  const editAndResend = useChatStore((s) => s.editAndResend)
  const activeThreadId = useThreadStore((s) => s.activeThreadId)
  const setActiveThread = useThreadStore((s) => s.setActiveThread)
  const fetchThreads = useThreadStore((s) => s.fetchThreads)

  const isRunning =
    status !== "idle" &&
    status !== "done" &&
    status !== "error" &&
    status !== "cancelled"

  const threadMessages = useMemo(
    () => toThreadMessages(messages, streamingParts, isRunning),
    [messages, streamingParts, isRunning],
  )

  // Use refs to avoid stale closures in runtime callbacks
  const stateRef = useRef({ activeThreadId, messages })
  stateRef.current = { activeThreadId, messages }

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    isRunning,
    convertMessage: (msg: ThreadMessageLike) => msg,

    onNew: async (message) => {
      const textPart = message.content.find((p) => p.type === "text")
      if (!textPart || textPart.type !== "text") return

      const currentThreadId = stateRef.current.activeThreadId
      const threadId = await sendMessage(
        textPart.text,
        currentThreadId || undefined,
      )
      if (threadId && !currentThreadId) {
        setActiveThread(threadId)
      }
      fetchThreads()
    },

    onEdit: async (message) => {
      const textPart = message.content.find((p) => p.type === "text")
      if (!textPart || textPart.type !== "text") return

      const currentThreadId = stateRef.current.activeThreadId
      if (!currentThreadId) return

      // sourceId is the original message ID being edited
      const sourceId = (message as Record<string, unknown>).sourceId as string | undefined
      if (sourceId) {
        const currentMessages = stateRef.current.messages
        const originalMsg = currentMessages.find((m) => m.id === sourceId)
        if (originalMsg) {
          await editAndResend(originalMsg.id, textPart.text, currentThreadId)
          fetchThreads()
          return
        }
      }

      // Fallback: treat as a new message
      await sendMessage(textPart.text, currentThreadId)
      fetchThreads()
    },

    onReload: async (parentId: string | null) => {
      const currentThreadId = stateRef.current.activeThreadId
      if (!currentThreadId) return
      await regenerateLastMessage(currentThreadId)
      fetchThreads()
    },

    onCancel: async () => {
      const currentThreadId = stateRef.current.activeThreadId
      await cancelChat(currentThreadId || undefined)
    },
  })

  return runtime
}
