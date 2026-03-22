"use client"

import { PanelLeftOpen } from "lucide-react"
import { AssistantRuntimeProvider } from "@assistant-ui/react"
import { Thread } from "@/components/chat/thread"
import { useWorkOSRuntime } from "@/lib/assistant-runtime"

interface ChatAreaProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function ChatArea({ sidebarOpen, onToggleSidebar }: ChatAreaProps) {
  const runtime = useWorkOSRuntime()

  return (
    <main className="relative flex flex-1 flex-col h-full min-w-0 bg-background">
      {/* Sidebar toggle — floating pill */}
      {!sidebarOpen && (
        <button
          onClick={onToggleSidebar}
          className="absolute top-3 left-3 z-20 flex size-9 items-center justify-center rounded-full text-gemini-on-surface-muted transition-colors hover:bg-secondary"
          title="Open Sidebar"
        >
          <PanelLeftOpen className="size-[18px]" />
        </button>
      )}

      <AssistantRuntimeProvider runtime={runtime}>
        <Thread />
      </AssistantRuntimeProvider>
    </main>
  )
}
