"use client"

import { useEffect, useState } from "react"
import { RefreshCw, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useSettingsStore } from "@/stores/settings-store"
import { api } from "@/lib/api"
import type { OllamaModel } from "@/lib/types"
import { WorkOSSparkleSmall } from "@/components/icons/workos-sparkle"
import { cn } from "@/lib/utils"

export function ModelSettings() {
  const { settings, updateSettings } = useSettingsStore()
  const [models, setModels] = useState<OllamaModel[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchModels = async () => {
    setLoading(true)
    setError(null)
    try {
      const m = await api.listModels()
      setModels(m)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchModels()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Active Model</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchModels}
            disabled={loading}
            className="gap-1 text-xs rounded-lg h-7"
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Select which Ollama model to use for conversations.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Failed to connect to Ollama: {error}
        </div>
      ) : (
        <div className="space-y-1 rounded-xl border divide-y overflow-hidden">
          {models.map((m) => {
            const isActive = settings.ollama_model === m.name
            return (
              <button
                key={m.name}
                onClick={() => updateSettings({ ollama_model: m.name })}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors duration-150",
                  isActive
                    ? "bg-accent/60"
                    : "hover:bg-secondary/60"
                )}
              >
                <WorkOSSparkleSmall className="size-3.5 shrink-0" />
                <span className="flex-1 font-mono text-xs truncate">{m.name}</span>
                {isActive && <Check className="size-4 text-primary shrink-0" />}
                {m.size && (
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums bg-secondary/60 rounded px-1.5 py-0.5">
                    {(m.size / 1e9).toFixed(1)}G
                  </span>
                )}
              </button>
            )
          })}
          {models.length === 0 && !loading && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              No models available
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-6">
              <RefreshCw className="size-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
