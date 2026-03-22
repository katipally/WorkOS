"use client"

import { useEffect, useState } from "react"
import { Sidebar } from "@/components/chat/sidebar"
import { ChatArea } from "@/components/chat/chat-area"
import { useThreadStore } from "@/stores/thread-store"
import { useSettingsStore } from "@/stores/settings-store"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { useKeyboardShortcuts, ShortcutsDialog } from "@/components/chat/keyboard-shortcuts"

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const fetchThreads = useThreadStore((s) => s.fetchThreads)
  const fetchSettings = useSettingsStore((s) => s.fetchSettings)
  const { shortcutsOpen, setShortcutsOpen } = useKeyboardShortcuts()

  useEffect(() => {
    fetchThreads()
    fetchSettings()
  }, [fetchThreads, fetchSettings])

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Inline sidebar — animates width open/closed */}
      <div
        className="shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{ width: sidebarOpen ? 260 : 0 }}
      >
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <ChatArea
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}
