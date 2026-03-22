"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  Trash2, RefreshCw, Server, Globe, Wrench, Plug2, FileJson2,
  Download, AlertCircle, Check, ChevronLeft, ChevronRight,
  Pencil, Zap, Eye, EyeOff, X, CheckCircle2, XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { api } from "@/lib/api"
import type { MCPServer, MCPTool } from "@/lib/types"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────
type ViewMode = "list" | "add" | "edit" | "tools"

// ─── Utility ────────────────────────────────────────────────────

function serversToConfig(servers: MCPServer[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {}
  for (const s of servers) {
    const entry: Record<string, unknown> = {}
    if (s.transport === "stdio") {
      if (s.config.command) entry.command = s.config.command
      if (s.config.args?.length) entry.args = s.config.args
      if (s.config.env && Object.keys(s.config.env).length) entry.env = s.config.env
    } else {
      if (s.config.url) entry.url = s.config.url
      if (s.config.headers && Object.keys(s.config.headers).length) entry.headers = s.config.headers
    }
    mcpServers[s.name] = entry
  }
  return JSON.stringify({ mcpServers }, null, 2)
}

function parseConfig(json: string): {
  servers: { name: string; transport: string; config: Record<string, unknown> }[]
  error?: string
} {
  try {
    const parsed = JSON.parse(json)
    const root = parsed.mcpServers ?? parsed
    if (typeof root !== "object" || Array.isArray(root)) {
      return { servers: [], error: "Expected an object with server entries" }
    }
    const servers: { name: string; transport: string; config: Record<string, unknown> }[] = []
    for (const [name, value] of Object.entries(root)) {
      const entry = value as Record<string, unknown>
      const isStdio = "command" in entry
      const transport = isStdio ? "stdio" : "http"
      const config: Record<string, unknown> = {}
      if (isStdio) {
        config.command = entry.command
        if (entry.args) config.args = entry.args
        if (entry.env) config.env = entry.env
      } else {
        config.url = entry.url
        if (entry.headers) config.headers = entry.headers
      }
      servers.push({ name, transport, config })
    }
    if (servers.length === 0) {
      return { servers: [], error: "No server entries found in the configuration" }
    }
    return { servers }
  } catch (e) {
    return { servers: [], error: `Invalid JSON: ${(e as Error).message}` }
  }
}

// ─── Service Icons ──────────────────────────────────────────────

const SERVICE_META: Record<string, { icon: string; color: string }> = {
  slack: { icon: "💬", color: "bg-[#E01E5A]/10 border-[#E01E5A]/30" },
  github: { icon: "🐙", color: "bg-purple-500/10 border-purple-500/30" },
  jira: { icon: "📋", color: "bg-[#0052CC]/10 border-[#0052CC]/30" },
  gmail: { icon: "📧", color: "bg-[#EA4335]/10 border-[#EA4335]/30" },
  gmeet: { icon: "📹", color: "bg-[#00897B]/10 border-[#00897B]/30" },
}

function getServerMeta(name: string) {
  const key = Object.keys(SERVICE_META).find((k) => name.toLowerCase().includes(k))
  return key ? SERVICE_META[key] : { icon: "🔌", color: "bg-secondary/50 border-border" }
}

// ─── Main Component ─────────────────────────────────────────────

export function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([])
  const [tools, setTools] = useState<MCPTool[]>([])
  const [view, setView] = useState<ViewMode>("list")
  const [loading, setLoading] = useState(false)
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null)
  const [serverTools, setServerTools] = useState<MCPTool[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([api.listMCPServers(), api.listAllTools()])
      setServers(s)
      setTools(t)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleDelete = async (id: string, name: string) => {
    await api.deleteMCPServer(id)
    toast.success(`${name} removed`)
    fetchData()
  }

  const handleExport = () => {
    const json = serversToConfig(servers)
    navigator.clipboard.writeText(json)
    toast.success("Configuration copied to clipboard")
  }

  const handleViewTools = async (server: MCPServer) => {
    setSelectedServer(server)
    try {
      const result = await api.listServerTools(server.id)
      setServerTools(result.tools)
    } catch {
      // Fallback: filter from all tools by prefix
      const prefix = server.name + "_"
      setServerTools(tools.filter((t) => t.name.startsWith(prefix)))
    }
    setView("tools")
  }

  const handleEdit = (server: MCPServer) => {
    setSelectedServer(server)
    setView("edit")
  }

  // ── Tools detail view ──
  if (view === "tools" && selectedServer) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setView("list"); setSelectedServer(null) }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" />
          Back to servers
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xl">{getServerMeta(selectedServer.name).icon}</span>
          <div>
            <h3 className="text-sm font-semibold">{selectedServer.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {serverTools.length} tools available
            </p>
          </div>
        </div>

        <div className="rounded-xl border divide-y max-h-[420px] overflow-y-auto custom-scrollbar">
          {serverTools.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No tools found. Server may not be connected.
            </div>
          ) : (
            serverTools.map((tool) => (
              <div key={tool.name} className="px-4 py-3 hover:bg-secondary/20 transition-colors">
                <div className="flex items-center gap-2">
                  <Wrench className="size-3 text-muted-foreground shrink-0" />
                  <span className="text-sm font-mono text-foreground">{tool.name}</span>
                </div>
                {tool.description && (
                  <p className="text-[11px] text-muted-foreground mt-1 ml-5 leading-relaxed">
                    {tool.description}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // ── Edit view ──
  if (view === "edit" && selectedServer) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setView("list"); setSelectedServer(null) }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" />
          Back to servers
        </button>
        <ServerEditor
          server={selectedServer}
          onSave={() => {
            setView("list")
            setSelectedServer(null)
            fetchData()
          }}
          onCancel={() => {
            setView("list")
            setSelectedServer(null)
          }}
        />
      </div>
    )
  }

  // ── Add view (JSON config) ──
  if (view === "add") {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setView("list")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-3.5" />
          Back to servers
        </button>
        <ConfigEditor
          existingNames={servers.map((s) => s.name)}
          onDone={() => {
            setView("list")
            fetchData()
          }}
          onCancel={() => setView("list")}
        />
      </div>
    )
  }

  // ── List view (main) ──
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">MCP Servers</h3>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading} className="h-7 w-7 p-0 rounded-lg" title="Refresh">
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            </Button>
            {servers.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleExport} className="h-7 w-7 p-0 rounded-lg" title="Export config">
                <Download className="size-3" />
              </Button>
            )}
            <Button size="sm" onClick={() => setView("add")} className="gap-1.5 h-7 rounded-lg text-xs">
              <FileJson2 className="size-3" />
              Add Server
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect MCP servers to extend the agent with external tools.
        </p>
      </div>

      {/* Empty state */}
      {servers.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <Plug2 className="mx-auto mb-2 size-8 opacity-30" />
          No MCP servers configured.
          <br />
          <span className="text-xs">Click &ldquo;Add Server&rdquo; to paste a JSON config.</span>
        </div>
      )}

      {/* Server cards */}
      <div className="space-y-2">
        {servers.map((server) => (
          <ServerCard
            key={server.id}
            server={server}
            onToggle={async (enabled) => {
              await api.updateMCPServer(server.id, { enabled })
              fetchData()
            }}
            onDelete={() => handleDelete(server.id, server.name)}
            onEdit={() => handleEdit(server)}
            onViewTools={() => handleViewTools(server)}
          />
        ))}
      </div>

      {/* All tools summary */}
      {tools.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <Wrench className="size-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {tools.length} tools loaded from {servers.filter((s) => s.enabled).length} server{servers.filter((s) => s.enabled).length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Server Card ────────────────────────────────────────────────

function ServerCard({
  server,
  onToggle,
  onDelete,
  onEdit,
  onViewTools,
}: {
  server: MCPServer
  onToggle: (enabled: boolean) => void
  onDelete: () => void
  onEdit: () => void
  onViewTools: () => void
}) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ status: string; tools_count?: number; error?: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const meta = getServerMeta(server.name)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testMCPServer(server.id)
      setTestResult(result)
      if (result.status === "ok") {
        toast.success(`${server.name}: ${result.tools_count} tools connected`)
      } else {
        toast.error(`${server.name}: ${result.error}`)
      }
    } catch (e) {
      setTestResult({ status: "error", error: (e as Error).message })
      toast.error(`Test failed: ${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={cn(
      "rounded-xl border p-3.5 space-y-2.5 transition-all duration-200",
      server.enabled
        ? "hover:bg-secondary/20"
        : "opacity-50 hover:opacity-70",
      meta.color,
    )}>
      {/* Row 1: Name + controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg shrink-0">{meta.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{server.name}</span>
              <Badge variant="secondary" className="text-[10px] rounded-md px-1.5 py-0 shrink-0">
                {server.transport}
              </Badge>
              {testResult && (
                testResult.status === "ok" ? (
                  <Badge variant="secondary" className="text-[10px] rounded-md px-1.5 py-0 gap-1 text-green-600 border-green-500/30 bg-green-500/10">
                    <CheckCircle2 className="size-2.5" />
                    {testResult.tools_count} tools
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] rounded-md px-1.5 py-0 gap-1 text-red-600 border-red-500/30 bg-red-500/10">
                    <XCircle className="size-2.5" />
                    Error
                  </Badge>
                )
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Test button */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg"
            onClick={handleTest}
            disabled={testing || !server.enabled}
            title="Test connection"
          >
            {testing ? (
              <RefreshCw className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <Zap className="size-3 text-muted-foreground" />
            )}
          </Button>

          {/* View tools */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg"
            onClick={onViewTools}
            title="View tools"
          >
            <Wrench className="size-3 text-muted-foreground" />
          </Button>

          {/* Edit */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg"
            onClick={onEdit}
            title="Edit server"
          >
            <Pencil className="size-3 text-muted-foreground" />
          </Button>

          {/* Toggle */}
          <Switch
            checked={server.enabled}
            onCheckedChange={onToggle}
          />

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg text-destructive hover:bg-destructive/10"
                onClick={() => { onDelete(); setConfirmDelete(false) }}
                title="Confirm delete"
              >
                <Check className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-lg"
                onClick={() => setConfirmDelete(false)}
                title="Cancel"
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-lg"
              onClick={() => setConfirmDelete(true)}
              title="Delete server"
            >
              <Trash2 className="size-3 text-muted-foreground hover:text-destructive transition-colors" />
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Command preview */}
      {server.transport === "stdio" && server.config?.command && (
        <p className="text-[11px] font-mono text-muted-foreground bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-1.5 truncate">
          {server.config.command} {server.config.args?.join(" ")}
        </p>
      )}
      {(server.transport === "http" || server.transport === "sse") && server.config?.url && (
        <p className="text-[11px] font-mono text-muted-foreground bg-black/5 dark:bg-white/5 rounded-lg px-2.5 py-1.5 truncate">
          {server.config.url}
        </p>
      )}

      {/* Row 3: Env vars preview (masked) */}
      {server.config?.env && Object.keys(server.config.env).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.keys(server.config.env).map((key) => (
            <Badge
              key={key}
              variant="outline"
              className="text-[9px] rounded px-1.5 py-0 font-mono text-muted-foreground"
            >
              {key}
            </Badge>
          ))}
        </div>
      )}

      {/* Test error detail */}
      {testResult?.status === "error" && testResult.error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2">
          <AlertCircle className="size-3 mt-0.5 shrink-0 text-destructive" />
          <p className="text-[11px] text-destructive/80 leading-relaxed break-all">{testResult.error}</p>
        </div>
      )}
    </div>
  )
}

// ─── Server Editor (Edit existing server) ───────────────────────

function ServerEditor({
  server,
  onSave,
  onCancel,
}: {
  server: MCPServer
  onSave: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(server.name)
  const [command, setCommand] = useState(server.config?.command || "")
  const [args, setArgs] = useState(server.config?.args?.join(" ") || "")
  const [url, setUrl] = useState(server.config?.url || "")
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string; visible: boolean }[]>(
    Object.entries(server.config?.env || {}).map(([key, value]) => ({
      key,
      value,
      visible: false,
    }))
  )
  const [saving, setSaving] = useState(false)
  const meta = getServerMeta(server.name)

  const addEnvVar = () => {
    setEnvPairs((prev) => [...prev, { key: "", value: "", visible: true }])
  }

  const removeEnvVar = (index: number) => {
    setEnvPairs((prev) => prev.filter((_, i) => i !== index))
  }

  const updateEnvVar = (index: number, field: "key" | "value", val: string) => {
    setEnvPairs((prev) =>
      prev.map((pair, i) => (i === index ? { ...pair, [field]: val } : pair))
    )
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const config: Record<string, unknown> = {}
      if (server.transport === "stdio") {
        config.command = command
        config.args = args.split(" ").filter(Boolean)
      } else {
        config.url = url
      }
      const env: Record<string, string> = {}
      for (const pair of envPairs) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value
        }
      }
      if (Object.keys(env).length > 0) config.env = env

      await api.updateMCPServer(server.id, { name, config })
      toast.success(`${name} updated`)
      onSave()
    } catch (e) {
      toast.error(`Failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border overflow-hidden bg-secondary/5">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 bg-secondary/20">
        <span className="text-lg">{meta.icon}</span>
        <div>
          <p className="text-sm font-medium">Edit Server</p>
          <p className="text-[11px] text-muted-foreground">{server.transport} transport</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Server Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        {/* Command / URL based on transport */}
        {server.transport === "stdio" ? (
          <>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Command</label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="uvx"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Arguments</label>
              <input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder="--from package-name server-name"
                className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
          </>
        ) : (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        )}

        {/* Environment Variables */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium text-muted-foreground">Environment Variables</label>
            <Button variant="ghost" size="sm" onClick={addEnvVar} className="h-6 text-[11px] rounded-md px-2">
              + Add
            </Button>
          </div>
          <div className="space-y-2">
            {envPairs.map((pair, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={pair.key}
                  onChange={(e) => updateEnvVar(i, "key", e.target.value)}
                  placeholder="KEY"
                  className="w-[140px] rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <div className="flex-1 relative">
                  <input
                    type={pair.visible ? "text" : "password"}
                    value={pair.value}
                    onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                    placeholder="value"
                    className="w-full rounded-lg border bg-background px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50 pr-8"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setEnvPairs((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, visible: !p.visible } : p))
                      )
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {pair.visible ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 rounded-md shrink-0"
                  onClick={() => removeEnvVar(i)}
                >
                  <X className="size-3 text-muted-foreground" />
                </Button>
              </div>
            ))}
            {envPairs.length === 0 && (
              <p className="text-[11px] text-muted-foreground italic">No environment variables</p>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/50 bg-secondary/20">
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 rounded-lg text-xs">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="h-7 rounded-lg text-xs gap-1.5"
        >
          {saving ? (
            <>
              <RefreshCw className="size-3 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Check className="size-3" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ─── JSON Config Editor (Add new servers) ───────────────────────

const CONFIG_TEMPLATE = `{
  "mcpServers": {
    "example-server": {
      "command": "uvx",
      "args": ["--from", "package-name", "server-name"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}`

function ConfigEditor({
  existingNames,
  onDone,
  onCancel,
}: {
  existingNames: string[]
  onDone: () => void
  onCancel: () => void
}) {
  const [configText, setConfigText] = useState(CONFIG_TEMPLATE)
  const [parseError, setParseError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [addedCount, setAddedCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
    }
  }, [])

  const handleChange = (value: string) => {
    setConfigText(value)
    setParseError(null)
    setAddedCount(0)
    if (value.trim()) {
      const { error } = parseConfig(value)
      if (error) setParseError(error)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault()
      const textarea = e.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const newValue = configText.substring(0, start) + "  " + configText.substring(end)
      setConfigText(newValue)
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2
      })
    }
  }

  const handleSave = async () => {
    const { servers, error } = parseConfig(configText)
    if (error) {
      setParseError(error)
      return
    }

    const dupes = servers.filter((s) => existingNames.includes(s.name))
    if (dupes.length > 0) {
      setParseError(`Server${dupes.length > 1 ? "s" : ""} already exist: ${dupes.map((d) => d.name).join(", ")}`)
      return
    }

    setSubmitting(true)
    let added = 0
    const errors: string[] = []
    for (const server of servers) {
      try {
        const result = await api.addMCPServer({
          name: server.name,
          transport: server.transport,
          config: server.config,
          enabled: true,
        })
        if (result?.connection_error) {
          errors.push(`${server.name}: ${String(result.connection_error).slice(0, 80)}`)
        }
        added++
      } catch (e) {
        errors.push(`${server.name}: ${(e as Error).message}`)
      }
    }
    setSubmitting(false)
    setAddedCount(added)

    if (added > 0) {
      toast.success(`Added ${added} MCP server${added > 1 ? "s" : ""}`)
    }
    if (errors.length > 0) {
      toast.warning("Some servers had connection issues", {
        description: errors.join("; ").slice(0, 200),
      })
    }
    if (added > 0) {
      onDone()
    }
  }

  const { servers: previewServers } = parseConfig(configText)

  return (
    <div className="rounded-xl border border-border/80 overflow-hidden bg-secondary/5">
      {/* Editor header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-secondary/20">
        <div className="flex items-center gap-2">
          <FileJson2 className="size-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Add MCP Server</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          Paste your config — supports multiple servers
        </span>
      </div>

      {/* Code editor */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={configText}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className={cn(
            "w-full resize-none bg-[var(--code-bg,hsl(var(--secondary)/0.3))] p-4 font-mono text-xs leading-relaxed text-foreground/90",
            "focus:outline-none placeholder:text-muted-foreground/40",
            "min-h-[200px] max-h-[320px] custom-scrollbar",
            parseError && "ring-1 ring-inset ring-destructive/30"
          )}
          rows={12}
        />
      </div>

      {/* Validation feedback */}
      {parseError && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-destructive/5 border-t border-destructive/20 text-destructive">
          <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed">{parseError}</p>
        </div>
      )}

      {/* Preview */}
      {!parseError && previewServers.length > 0 && (
        <div className="px-4 py-2.5 border-t border-border/50 bg-secondary/10">
          <p className="text-[11px] text-muted-foreground mb-1.5">
            {previewServers.length} server{previewServers.length > 1 ? "s" : ""} detected:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {previewServers.map((s) => {
              const meta = getServerMeta(s.name)
              return (
                <Badge
                  key={s.name}
                  variant="secondary"
                  className={cn(
                    "text-[10px] rounded-md gap-1",
                    existingNames.includes(s.name) && "border-destructive/40 text-destructive"
                  )}
                >
                  <span className="text-xs">{meta.icon}</span>
                  {s.name}
                  {existingNames.includes(s.name) && " (exists)"}
                </Badge>
              )
            })}
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/50 bg-secondary/20">
        <p className="text-[10px] text-muted-foreground">
          Format: <code className="px-1 py-0.5 rounded bg-secondary/50">{"{ \"mcpServers\": { ... } }"}</code>
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 rounded-lg text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={submitting || !!parseError || previewServers.length === 0}
            className="h-7 rounded-lg text-xs gap-1.5"
          >
            {submitting ? (
              <>
                <RefreshCw className="size-3 animate-spin" />
                Adding...
              </>
            ) : addedCount > 0 ? (
              <>
                <Check className="size-3" />
                Added
              </>
            ) : (
              <>Save Servers</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
