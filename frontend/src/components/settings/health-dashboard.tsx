"use client"

import { useEffect, useState } from "react"
import { RefreshCw, CheckCircle, XCircle, Activity } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

interface HealthData {
  status: string
  mcp_tools_count: number
  mcp_initialized: boolean
}

export function HealthDashboard() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  const check = async () => {
    setLoading(true)
    try {
      const h = await api.health() as unknown as HealthData
      setHealth(h)
    } catch {
      setHealth(null)
    }
    try {
      await api.listModels()
      setOllamaOk(true)
    } catch {
      setOllamaOk(false)
    }
    setLoading(false)
  }

  useEffect(() => {
    check()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Activity className="size-3.5" />
            System Health
          </h3>
          <Button variant="ghost" size="sm" onClick={check} disabled={loading} className="h-7 rounded-lg gap-1 text-xs">
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Monitor connectivity and system status.
        </p>
      </div>

      <div className="rounded-xl border divide-y overflow-hidden">
        <HealthRow
          label="Backend API"
          ok={health?.status === "ok"}
          detail={health ? "Connected" : "Unreachable"}
        />
        <HealthRow
          label="Ollama"
          ok={ollamaOk}
          detail={ollamaOk ? "Connected" : ollamaOk === false ? "Unreachable" : "Checking..."}
        />
        <HealthRow
          label="MCP Tools"
          ok={health?.mcp_initialized ?? null}
          detail={health ? `${health.mcp_tools_count} tools loaded` : "Unknown"}
        />
      </div>
    </div>
  )
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2.5">
        {ok === null ? (
          <div className="size-4 rounded-full bg-muted animate-pulse" />
        ) : ok ? (
          <CheckCircle className="size-4 text-chart-2" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
        <span className="text-sm">{label}</span>
      </div>
      <span className={cn(
        "text-xs font-medium rounded-md px-2 py-0.5",
        ok ? "bg-chart-2/10 text-chart-2" : ok === false ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"
      )}>
        {detail}
      </span>
    </div>
  )
}
