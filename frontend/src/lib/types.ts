// ─── Message Parts ───────────────────────────────────────────────

export interface TextPart {
  type: "text"
  content: string
}

export interface ReasoningPart {
  type: "reasoning"
  content: string
}

export interface ToolCallPart {
  type: "tool_call"
  id: string
  name: string
  args: Record<string, unknown>
  status: "pending" | "running" | "success" | "error" | "rejected"
  result?: string
}

export interface ErrorPart {
  type: "error"
  message: string
}

export interface InterruptPart {
  type: "interrupt"
  tool_call_id: string
  tool_name: string
  args: Record<string, unknown>
  message: string
}

export interface StepPart {
  type: "step"
  step: number
  node: string
}

export interface TodoItem {
  title: string
  status: "pending" | "in_progress" | "done"
}

export interface TodoPart {
  type: "todo"
  todos: TodoItem[]
}

export interface SubAgentPart {
  type: "sub_agent"
  agent: string
  task: string
  tool_id: string
  status: "running" | "success" | "error"
  result?: string
}

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ErrorPart
  | InterruptPart
  | StepPart
  | TodoPart
  | SubAgentPart

// ─── Messages ───────────────────────────────────────────────────

export interface Message {
  id: string
  thread_id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  created_at: string
}

// ─── Threads ────────────────────────────────────────────────────

export interface Thread {
  id: string
  title: string
  created_at: string
  updated_at: string
}

// ─── MCP Servers ────────────────────────────────────────────────

export interface MCPServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

export interface MCPServer {
  id: string
  name: string
  transport: "stdio" | "http" | "sse"
  config: MCPServerConfig
  enabled: boolean
  created_at: string
  tool_approvals?: Record<string, boolean>
}

export interface MCPTool {
  name: string
  description: string
}

// ─── Settings ───────────────────────────────────────────────────

export interface Settings {
  ollama_model: string
  ollama_url: string
  max_steps: number
  system_prompt: string
  theme: "light" | "dark" | "system"
}

// ─── SSE Stream Events (new protocol) ───────────────────────────

export interface StreamEventMetadata {
  event: "metadata"
  data: { thread_id: string; run_id: string }
}

export interface StreamEventThinking {
  event: "thinking"
  data: { content: string }
}

export interface StreamEventText {
  event: "text"
  data: { content: string }
}

export interface StreamEventToolStart {
  event: "tool_start"
  data: { id: string; name: string; args: Record<string, unknown> }
}

export interface StreamEventToolEnd {
  event: "tool_end"
  data: { id: string; name?: string; result: string; error?: string }
}

export interface StreamEventTodos {
  event: "todos"
  data: { todos: TodoItem[] }
}

export interface StreamEventStep {
  event: "step"
  data: { step: number; node: string }
}

export interface StreamEventInterrupt {
  event: "interrupt"
  data: { tool_call_id: string; tool_name: string; args: Record<string, unknown>; message: string }
}

export interface StreamEventError {
  event: "error"
  data: { message: string; recoverable?: boolean }
}

export interface StreamEventEnd {
  event: "end"
  data: { thread_id: string }
}

export interface StreamEventSubAgentStart {
  event: "sub_agent_start"
  data: { agent: string; task: string; tool_id: string }
}

export interface StreamEventSubAgentEnd {
  event: "sub_agent_end"
  data: { agent: string; tool_id: string; result: string; error?: string }
}

export type StreamEvent =
  | StreamEventMetadata
  | StreamEventThinking
  | StreamEventText
  | StreamEventToolStart
  | StreamEventToolEnd
  | StreamEventTodos
  | StreamEventStep
  | StreamEventInterrupt
  | StreamEventError
  | StreamEventEnd
  | StreamEventSubAgentStart
  | StreamEventSubAgentEnd

// ─── Ollama Models ──────────────────────────────────────────────

export interface OllamaModel {
  name: string
  size?: number
  modified_at?: string
  digest?: string
}

// ─── Agent Status ───────────────────────────────────────────────

export type AgentStatus =
  | "idle"
  | "reasoning"
  | "acting"
  | "observing"
  | "done"
  | "error"
  | "cancelled"
  | "waiting_approval"

// ─── Service Integration ────────────────────────────────────────

export interface ServiceStatus {
  name: string
  display_name: string
  connected: boolean
  tools_count: number
  server_id: string | null
  coming_soon?: boolean
}
