"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { GeneralSettings } from "@/components/settings/general-settings"
import { MCPSettings } from "@/components/settings/mcp-settings"
import { ModelSettings } from "@/components/settings/model-settings"
import { HealthDashboard } from "@/components/settings/health-dashboard"
import {
  Settings2,
  Cpu,
  Plug2,
  Activity,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const sections = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "models", label: "Models", icon: Cpu },
  { id: "mcp", label: "MCP Servers", icon: Plug2 },
  { id: "health", label: "Health", icon: Activity },
] as const

type SectionId = (typeof sections)[number]["id"]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SectionId>("general")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] w-[90vw] max-w-5xl flex-col overflow-hidden rounded-2xl p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-4">
          <DialogTitle className="text-lg font-semibold">Settings</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Side navigation */}
          <nav className="shrink-0 w-52 border-r border-border/60 bg-secondary/20 p-2 space-y-0.5 overflow-y-auto custom-scrollbar">
            {sections.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors duration-150",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {section.label}
                </button>
              )
            })}
          </nav>

          {/* Content panel */}
          <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-6">
            <div className="mx-auto max-w-2xl">
              {activeSection === "general" && <GeneralSettings />}
              {activeSection === "models" && <ModelSettings />}
              {activeSection === "mcp" && <MCPSettings />}
              {activeSection === "health" && <HealthDashboard />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
