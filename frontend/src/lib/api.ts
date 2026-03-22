const API_BASE = process.env.NEXT_PUBLIC_API_URL || ""

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json()
}

// ─── Threads ────────────────────────────────────────────────────

import type { MCPServer, MCPServerConfig, Message, OllamaModel, Settings, Thread, MCPTool, ServiceStatus } from "./types"

export const api = {
  // Threads
  listThreads: () => fetchJSON<Thread[]>("/api/threads"),

  createThread: (title: string) =>
    fetchJSON<Thread>("/api/threads", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  getThread: (id: string) => fetchJSON<Thread>(`/api/threads/${id}`),

  updateThread: (id: string, title: string) =>
    fetchJSON<Thread>(`/api/threads/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    }),

  deleteThread: (id: string) =>
    fetchJSON<{ status: string }>(`/api/threads/${id}`, { method: "DELETE" }),

  getMessages: (threadId: string) =>
    fetchJSON<Message[]>(`/api/threads/${threadId}/messages`),

  exportThread: async (threadId: string) => {
    const res = await fetch(`${API_BASE}/api/threads/${threadId}/export`)
    return res.text()
  },

  // Chat
  chatStream: (message: string, threadId?: string, model?: string, signal?: AbortSignal) => {
    const body = JSON.stringify({
      message,
      thread_id: threadId || null,
      model: model || null,
    })
    return fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal,
    })
  },

  cancelChat: (threadId: string) =>
    fetchJSON<{ status: string }>("/api/chat/cancel", {
      method: "POST",
      body: JSON.stringify({ thread_id: threadId }),
    }),

  approveToolCall: (threadId: string, decision: "approve" | "reject", signal?: AbortSignal) =>
    fetch(`${API_BASE}/api/chat/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id: threadId, decision }),
      signal,
    }),

  // Models
  listModels: () =>
    fetchJSON<{ models: OllamaModel[] }>("/api/models").then((r) => r.models),

  // MCP Servers
  listMCPServers: () => fetchJSON<MCPServer[]>("/api/mcp-servers"),

  addMCPServer: (data: {
    name: string
    transport: string
    config: MCPServerConfig
    enabled?: boolean
  }) =>
    fetchJSON<MCPServer & { connection_error?: string }>("/api/mcp-servers", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateMCPServer: (id: string, data: Partial<MCPServer>) =>
    fetchJSON<MCPServer>(`/api/mcp-servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteMCPServer: (id: string) =>
    fetchJSON<{ status: string }>(`/api/mcp-servers/${id}`, {
      method: "DELETE",
    }),

  listAllTools: () =>
    fetchJSON<{ tools: MCPTool[] }>("/api/mcp-tools").then(
      (r) => r.tools
    ),

  testMCPServer: (id: string) =>
    fetchJSON<{
      status: string
      server_name?: string
      tools_count?: number
      tools?: MCPTool[]
      error?: string
    }>(`/api/mcp-servers/${id}/test`, { method: "POST" }),

  listServerTools: (id: string) =>
    fetchJSON<{ server_name: string; tools: MCPTool[] }>(
      `/api/mcp-servers/${id}/tools`
    ),

  updateToolApproval: (
    serverId: string,
    toolName: string,
    requiresApproval: boolean
  ) =>
    fetchJSON(`/api/mcp-servers/${serverId}/tools/${encodeURIComponent(toolName)}/approval`, {
      method: "PUT",
      body: JSON.stringify({ requires_approval: requiresApproval }),
    }),

  // Settings
  getSettings: () => fetchJSON<Settings>("/api/settings"),

  updateSettings: (data: Partial<Settings>) =>
    fetchJSON<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Health
  health: () => fetchJSON<{ status: string }>("/api/health"),

  // Services
  getServiceStatus: () => fetchJSON<ServiceStatus[]>("/api/services/status"),

  regeneratePrompt: () =>
    fetchJSON<{ status: string; connected_services: string[]; prompt_length: number }>(
      "/api/services/prompt/regenerate",
      { method: "POST" }
    ),
}
