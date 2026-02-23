export type Tab = "slack" | "github" | "meetings" | "settings";

// ─── AI Types ────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  focused_tab: string;
  scope: string;
  branch_id: number;
  max_branch: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  branch_id: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  tool_calls: ToolCall[];
  tool_name?: string;
  tool_result?: unknown;
  metadata: Record<string, unknown>;
  pinned: boolean;
  created_at: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatSessionDetail extends ChatSession {
  messages: ChatMessage[];
}

export interface SSEEvent {
  event: string;
  data: string;
}

// ─── Meeting Types ───────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  title: string;
  description: string;
  meeting_date: string;
  status: "pending" | "processing" | "ready" | "error";
  summary?: string;
  action_items: ActionItem[];
  error?: string;
  created_at: string;
  updated_at: string;
  files: MeetingFile[];
}

export interface MeetingFile {
  id: string;
  meeting_id?: string;
  filename: string;
  filetype: string;
  filesize: number;
  mime_type: string;
  status: string;
  transcription?: string;
}

export interface ActionItem {
  text: string;
  assignee?: string;
  due_date?: string;
  completed: boolean;
}

// ─── Settings Types ──────────────────────────────────────────────────────────

export interface AISettings {
  ai_provider: string;
  ai_model: string;
  embedding_provider: string;
  embedding_model: string;
  meeting_summary_provider: string;
  meeting_summary_model: string;
  meeting_actions_provider: string;
  meeting_actions_model: string;
  vision_provider: string;
  vision_model: string;
  openai_api_key: string;
  ollama_base_url: string;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
}
