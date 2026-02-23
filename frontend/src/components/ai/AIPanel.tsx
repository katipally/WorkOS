import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Bot, X, Plus,
  Layers, Layout, Sparkles, WifiOff, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store/useAppStore";
import { aiApi, settingsApi } from "@/api/client";
import type { ChatSession } from "@/types";
import { ChatMessageItem } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { SessionHeader } from "./SessionHeader";
import { ApprovalCard } from "./ApprovalCard";
import { ContextBadge } from "./ContextBadge";
import { PlanCard, type PlanStep } from "./PlanCard";
import { ReceiptBadge, type ReceiptData } from "./ReceiptBadge";
import { ChatGrid } from "./ChatGrid";
import { ExportButton } from "./RichContent";
import { ActionCard, type ActionCardData } from "./ActionCard";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";
import { ThinkingBar } from "@/components/prompt-kit/thinking-bar";
import { Tool, type ToolPart } from "@/components/prompt-kit/tool";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/prompt-kit/reasoning";
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/prompt-kit/chat-container";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";

const SUGGESTIONS = [
  "Summarize recent Slack activity",
  "What open PRs need review?",
  "Show action items from last meeting",
  "Find issues assigned to me",
];

/* ─────────────────────── types for streaming state ──────────────────────── */
interface StreamingToolUse {
  tool: string;
  input: Record<string, unknown>;
  id?: string;
}
interface StreamingToolResult {
  tool: string;
  output: unknown;
  id?: string;
}

/* ─────────────────────── retry / connection config ──────────────────────── */
const MAX_RETRY = 3;
const RETRY_BASE_MS = 1500;

export function AIPanel() {
  const {
    aiPanelOpen, setAIPanelOpen, activeTab,
    currentChatSessionId, setCurrentChatSessionId,
  } = useAppStore();

  const queryClient = useQueryClient();
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [thoughts, setThoughts] = useState<string[]>([]);
  const [toolUses, setToolUses] = useState<StreamingToolUse[]>([]);
  const [toolResults, setToolResults] = useState<StreamingToolResult[]>([]);
  const [pendingApproval, setPendingApproval] = useState<{ action: string; details: Record<string, unknown> } | null>(null);
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [receipts, setReceipts] = useState<ReceiptData[]>([]);
  const [actionCards, setActionCards] = useState<ActionCardData[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [scope, setScope] = useState<"workspace" | "tab">("workspace");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const retryCountRef = useRef(0);
  const mountedRef = useRef(true);

  /* ─── Online/offline detection ──────────────────────────────────────── */
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  /* ─── Cleanup on unmount ────────────────────────────────────────────── */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /* ─── Auto-scroll — handled by ChatContainer (StickToBottom) ──────── */

  /* ─── Queries ──────────────────────────────────────────────────────────── */
  const { data: aiSettings } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: settingsApi.getAI,
    enabled: aiPanelOpen,
    staleTime: 60_000,
  });

  const { data: sessionDetail, error: sessionError } = useQuery({
    queryKey: ["ai-session", currentChatSessionId],
    queryFn: () => aiApi.getSession(currentChatSessionId!),
    enabled: !!currentChatSessionId && aiPanelOpen,
    retry: 1, // Only retry once for session fetch (handles 404 stale IDs quickly)
  });

  // Track whether the stored session ID is confirmed stale (404)
  const isSessionStale = !!(
    sessionError &&
    (sessionError as any)?.response?.status === 404
  );

  // If the stored session ID no longer exists in DB (404), clear it
  useEffect(() => {
    if (isSessionStale && currentChatSessionId) {
      setCurrentChatSessionId(null);
    }
  }, [isSessionStale, currentChatSessionId, setCurrentChatSessionId]);

  /* ─── Reset all streaming state ──────────────────────────────────────── */
  const resetStreamingState = useCallback(() => {
    setStreamingContent("");
    setOptimisticUserMsg(null);
    setThoughts([]);
    setToolUses([]);
    setToolResults([]);
    setPlanSteps([]);
    setReceipts([]);
    setActionCards([]);
    setIsStreaming(false);
    setEditingMessageId(null);
  }, []);

  /* ─── Send message (SSE streaming) with retry ──────────────────────── */
  const sendMessage = useCallback(async (message: string, _retry = 0) => {
    if (!message.trim() || isStreaming) return;
    if (!isOnline) {
      setStreamError("You are offline. Please check your connection.");
      return;
    }

    setIsStreaming(true);
    setStreamingContent("");
    setThoughts([]);
    setToolUses([]);
    setToolResults([]);
    setPlanSteps([]);
    setReceipts([]);
    setActionCards([]);
    setPendingApproval(null);
    setStreamError(null);
    setOptimisticUserMsg(message.trim());
    setEditingMessageId(null);

    // ChatContainer auto-scrolls via StickToBottom

    const controller = new AbortController();
    abortRef.current = controller;

    const mentionMap: Record<string, string> = {
      slack: "slack", github: "github", meetings: "meetings",
    };
    const contextMentions = [...message.matchAll(/@(\w+)/g)]
      .map((m) => mentionMap[m[1].toLowerCase()])
      .filter(Boolean);

    try {
      // Send session_id if we have one and it's not confirmed stale (404).
      // This avoids both: sending a stale ID (404 crash) and losing a freshly-created
      // ID because sessionDetail hasn't loaded yet.
      const validSessionId =
        currentChatSessionId && !isSessionStale ? currentChatSessionId : null;

      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: validSessionId,
          message,
          focused_tab: activeTab,
          scope,
          branch_id: sessionDetail?.branch_id ?? 1,
          context_mentions: contextMentions,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");

      retryCountRef.current = 0; // reset on successful connection

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let currentEventType = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!mountedRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("id:") || line.startsWith("retry:") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);

            switch (currentEventType) {
              case "token":
                if (typeof data.content === "string") {
                  fullContent += data.content;
                  setStreamingContent(fullContent);
                }
                break;

              case "thought":
                if (data.step) {
                  setThoughts((prev) => [...prev, data.step]);
                }
                break;

              case "plan_step":
                if (data.id != null) {
                  setPlanSteps((prev) => {
                    const existing = prev.findIndex((s) => s.id === data.id);
                    if (existing >= 0) {
                      // Update existing step (e.g. status change)
                      const updated = [...prev];
                      updated[existing] = { ...updated[existing], ...data };
                      return updated;
                    }
                    // New step — require label for initial creation
                    if (data.label) {
                      return [...prev, {
                        id: data.id,
                        label: data.label,
                        tool: data.tool,
                        status: data.status || "pending",
                      }];
                    }
                    return prev;
                  });
                }
                break;

              case "tool_use":
                if (data.tool && data.input) {
                  setToolUses((prev) => [...prev, { tool: data.tool, input: data.input, id: data.id }]);
                  // Mark matching plan step as running
                  setPlanSteps((prev) =>
                    prev.map((s) => s.tool === data.tool && s.status === "pending"
                      ? { ...s, status: "running" }
                      : s
                    )
                  );
                }
                break;

              case "tool_result":
                if (data.tool && "output" in data) {
                  setToolResults((prev) => [...prev, { tool: data.tool, output: data.output, id: data.id }]);
                  // Mark matching plan step as done
                  setPlanSteps((prev) =>
                    prev.map((s) => s.tool === data.tool && s.status === "running"
                      ? { ...s, status: "done" }
                      : s
                    )
                  );
                }
                break;

              case "receipt":
                if (data.tool && data.action) {
                  setReceipts((prev) => [...prev, {
                    tool: data.tool,
                    action: data.action,
                    summary: data.summary || "",
                    success: data.success !== false,
                    link: data.link,
                  }]);
                }
                break;

              case "action_card":
                if (data.type && data.title) {
                  setActionCards((prev) => [...prev, {
                    type: data.type,
                    title: data.title,
                    description: data.description,
                    actions: data.actions,
                    metadata: data.metadata,
                  }]);
                }
                break;

              case "approval":
                if (data.action && data.details) {
                  setPendingApproval({ action: data.action, details: data.details });
                }
                break;

              case "session":
                if (data.session_id) {
                  // Always accept the session_id from backend — it's the authoritative source.
                  // This handles: first message (null→new), and stale→replaced scenarios.
                  setCurrentChatSessionId(data.session_id);
                }
                break;

              case "done":
                // Clear ALL streaming state BEFORE invalidating queries to avoid duplication
                resetStreamingState();
                queryClient.invalidateQueries({ queryKey: ["ai-session", data.session_id || currentChatSessionId] });
                queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                break;

              case "error":
                if (data.message) {
                  setStreamError(data.message);
                }
                break;

              default:
                // Fallback: infer event type from data shape (backward compat)
                if ("content" in data && typeof data.content === "string") {
                  fullContent += data.content;
                  setStreamingContent(fullContent);
                } else if ("step" in data) {
                  setThoughts((prev) => [...prev, data.step]);
                } else if ("tool" in data && "input" in data) {
                  setToolUses((prev) => [...prev, { tool: data.tool, input: data.input, id: data.id }]);
                } else if ("tool" in data && "output" in data) {
                  setToolResults((prev) => [...prev, { tool: data.tool, output: data.output, id: data.id }]);
                } else if ("action" in data && "details" in data) {
                  setPendingApproval({ action: data.action, details: data.details });
                } else if ("session_id" in data && !("message_id" in data)) {
                  if (data.session_id) {
                    setCurrentChatSessionId(data.session_id);
                  }
                } else if ("message_id" in data) {
                  resetStreamingState();
                  queryClient.invalidateQueries({ queryKey: ["ai-session", data.session_id || currentChatSessionId] });
                  queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                } else if ("message" in data) {
                  setStreamError(data.message);
                }
                break;
            }

            currentEventType = "message";
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        // User-initiated abort — do nothing
      } else if (_retry < MAX_RETRY && mountedRef.current) {
        // Auto-retry with exponential backoff
        retryCountRef.current = _retry + 1;
        const delay = RETRY_BASE_MS * Math.pow(2, _retry);
        setStreamError(`Connection lost. Retrying in ${Math.round(delay / 1000)}s... (${_retry + 1}/${MAX_RETRY})`);
        await new Promise((r) => setTimeout(r, delay));
        if (mountedRef.current) {
          setStreamError(null);
          setIsStreaming(false);
          return sendMessage(message, _retry + 1);
        }
      } else {
        setStreamError("Connection failed. Please try again.");
      }
    } finally {
      if (mountedRef.current) {
        // Only reset if we didn't already reset via "done" event
        setIsStreaming(false);
        abortRef.current = null;
      }
    }
  }, [currentChatSessionId, activeTab, scope, sessionDetail, isSessionStale, isStreaming, isOnline, queryClient, setCurrentChatSessionId, resetStreamingState]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    if (currentChatSessionId) aiApi.stopGeneration(currentChatSessionId);
  }, [currentChatSessionId]);

  const handleApproval = useCallback(async (approved: boolean) => {
    if (!currentChatSessionId) return;
    setPendingApproval(null);
    setIsStreaming(true);
    setStreamingContent("");
    setThoughts([]);
    setToolResults([]);
    setReceipts([]);
    setStreamError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ai/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: currentChatSessionId, approved }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let currentEventType = "message";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!mountedRef.current) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith("id:") || line.startsWith("retry:") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr);
            switch (currentEventType) {
              case "token":
                if (typeof data.content === "string") {
                  fullContent += data.content;
                  setStreamingContent(fullContent);
                }
                break;
              case "thought":
                if (data.step) setThoughts((prev) => [...prev, data.step]);
                break;
              case "tool_result":
                if (data.tool && "output" in data) {
                  setToolResults((prev) => [...prev, { tool: data.tool, output: data.output, id: data.id }]);
                }
                break;
              case "receipt":
                if (data.tool && data.action) {
                  setReceipts((prev) => [...prev, {
                    tool: data.tool, action: data.action,
                    summary: data.summary || "", success: data.success !== false, link: data.link,
                  }]);
                }
                break;
              case "done":
                resetStreamingState();
                queryClient.invalidateQueries({ queryKey: ["ai-session", data.session_id || currentChatSessionId] });
                queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                break;
              case "error":
                if (data.message) setStreamError(data.message);
                break;
            }
            currentEventType = "message";
          } catch { /* skip non-JSON */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== "AbortError") {
        setStreamError("Approval action failed. Please try again.");
      }
    } finally {
      if (mountedRef.current) {
        setIsStreaming(false);
        abortRef.current = null;
      }
    }
  }, [currentChatSessionId, queryClient, resetStreamingState]);

  const handleNewChat = useCallback(() => {
    setCurrentChatSessionId(null);
    resetStreamingState();
    setPendingApproval(null);
    setShowHistory(false);
    setStreamError(null);
  }, [setCurrentChatSessionId, resetStreamingState]);

  const handleTogglePin = useCallback(async (messageId: string) => {
    if (!currentChatSessionId) return;
    await aiApi.togglePin(currentChatSessionId, messageId);
    queryClient.invalidateQueries({ queryKey: ["ai-session", currentChatSessionId] });
  }, [currentChatSessionId, queryClient]);

  const handleSelectSession = useCallback((session: ChatSession) => {
    setCurrentChatSessionId(session.id);
    setShowHistory(false);
    setStreamingContent("");
    setStreamError(null);
    setPlanSteps([]);
    setReceipts([]);
    setActionCards([]);
  }, [setCurrentChatSessionId]);

  const handleEditMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!currentChatSessionId || isStreaming) return;
    // Create a branch from the message being edited, then send the new content
    try {
      const branchResult = await aiApi.createBranch(currentChatSessionId, messageId);
      // Immediately update the query cache so sendMessage picks up the new branch_id
      queryClient.setQueryData(["ai-session", currentChatSessionId], (old: any) => {
        if (!old) return old;
        return { ...old, branch_id: branchResult.branch_id, max_branch: branchResult.max_branch };
      });
      queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
      setEditingMessageId(null);
      // Send the edited message on the new branch
      await sendMessage(newContent);
    } catch {
      setStreamError("Failed to edit message. Please try again.");
    }
  }, [currentChatSessionId, isStreaming, queryClient, sendMessage]);

  const handleBranch = useCallback(async (fromMessageId: string) => {
    if (!currentChatSessionId) return;
    try {
      await aiApi.createBranch(currentChatSessionId, fromMessageId);
      queryClient.invalidateQueries({ queryKey: ["ai-session", currentChatSessionId] });
      queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
    } catch { /* ignore */ }
  }, [currentChatSessionId, queryClient]);

  const handleRegenerate = useCallback(async () => {
    if (!sessionDetail || !currentChatSessionId || isStreaming) return;
    const lastUserMsg = [...sessionDetail.messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    try {
      // Branch from the last user message so the old response is preserved
      const branchResult = await aiApi.createBranch(currentChatSessionId, lastUserMsg.id);
      queryClient.setQueryData(["ai-session", currentChatSessionId], (old: any) => {
        if (!old) return old;
        return { ...old, branch_id: branchResult.branch_id, max_branch: branchResult.max_branch };
      });
      queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
      await sendMessage(lastUserMsg.content);
    } catch {
      setStreamError("Failed to regenerate. Please try again.");
    }
  }, [sessionDetail, currentChatSessionId, isStreaming, sendMessage, queryClient]);

  /* ─── Build tool result lookup from messages ─────────────────────────── */
  const messageToolResults = useMemo(() => {
    const map = new Map<string, { output?: Record<string, unknown>; error?: string }>();
    const msgs = sessionDetail?.messages || [];
    for (const m of msgs) {
      if (m.role === "tool" && m.tool_name) {
        try {
          const parsed = JSON.parse(m.content);
          map.set(m.id, { output: parsed });
        } catch {
          map.set(m.id, { output: { result: m.content } });
        }
      }
    }
    for (const tr of toolResults) {
      if (tr.id) {
        map.set(tr.id, { output: tr.output as Record<string, unknown> });
      }
    }
    return map;
  }, [sessionDetail?.messages, toolResults]);

  /* ─── Build streaming tool parts ──────────────────────────────────────── */
  const streamingToolParts: ToolPart[] = useMemo(() => {
    return toolUses.map((tu) => {
      const result = toolResults.find((tr) => tr.id === tu.id || tr.tool === tu.tool);
      return {
        type: tu.tool.replace(/_/g, " "),
        state: result
          ? "output-available" as const
          : "input-streaming" as const,
        input: tu.input,
        output: result?.output as Record<string, unknown> | undefined,
        toolCallId: tu.id,
      };
    });
  }, [toolUses, toolResults]);

  /* ─── Derived state ────────────────────────────────────────────────────── */
  const messages = sessionDetail?.messages || [];
  const allMessages = useMemo(() => {
    const base = [...messages];

    if (optimisticUserMsg) {
      const alreadyPresent = base.some(
        (m) => m.role === "user" && m.content === optimisticUserMsg
      );
      if (!alreadyPresent) {
        base.push({
          id: "optimistic-user",
          role: "user" as const,
          content: optimisticUserMsg,
          branch_id: sessionDetail?.branch_id ?? 1,
          tool_calls: [],
          metadata: {},
          pinned: false,
          created_at: new Date().toISOString(),
        });
      }
    }

    if (streamingContent) {
      base.push({
        id: "streaming",
        role: "assistant" as const,
        content: streamingContent,
        branch_id: sessionDetail?.branch_id ?? 1,
        tool_calls: [],
        metadata: {},
        pinned: false,
        created_at: new Date().toISOString(),
      });
    }

    return base;
  }, [messages, optimisticUserMsg, streamingContent, sessionDetail?.branch_id]);

  // Auto-scroll is now handled by ChatContainer (StickToBottom)

  const modelLabel = aiSettings
    ? `${aiSettings.ai_provider === "openai" ? "OpenAI" : "Ollama"} · ${aiSettings.ai_model || "default"}`
    : null;

  const isEmpty = allMessages.length === 0 && !isStreaming;

  if (!aiPanelOpen) return null;

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 440, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative h-full border-l border-border bg-background flex flex-col overflow-hidden"
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 bg-background">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <span className="font-semibold text-sm text-foreground">AI Assistant</span>
          <ContextBadge tab={activeTab} />
          {!isOnline && (
            <Badge variant="destructive" className="text-[10px] h-4 px-1.5 gap-1">
              <WifiOff className="w-2.5 h-2.5" />
              Offline
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {currentChatSessionId && sessionDetail && (
            <ExportButton
              messages={sessionDetail.messages}
              title={sessionDetail.title}
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 rounded-lg ${scope === "tab" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setScope((s) => s === "workspace" ? "tab" : "workspace")}
              >
                {scope === "workspace" ? <Layers className="w-3.5 h-3.5" /> : <Layout className="w-3.5 h-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{scope === "workspace" ? "Whole Workspace" : "This Tab Only"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" onClick={handleNewChat}>
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
          <ChatGrid
            open={showHistory}
            onClose={() => setShowHistory(false)}
            onSelectSession={handleSelectSession}
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 rounded-lg ${showHistory ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setShowHistory(!showHistory)}
              >
                <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>History</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" onClick={() => setAIPanelOpen(false)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Model + scope info ─────────────────────────────────────────── */}
      {(modelLabel || scope === "tab") && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
          {modelLabel && (
            <span className="text-[11px] text-muted-foreground font-mono truncate">{modelLabel}</span>
          )}
          <div className="flex-1" />
          {scope === "tab" && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground shrink-0">
              Tab scope
            </Badge>
          )}
        </div>
      )}

      {/* ── Session Header ─────────────────────────────────────────────── */}
      {currentChatSessionId && sessionDetail && (
        <SessionHeader session={sessionDetail} onBranch={handleBranch} />
      )}

      {/* ── Chat Messages (ChatContainer provides auto-stick-to-bottom) ── */}
      <ChatContainerRoot className="flex-1 min-h-0 relative">
        <ChatContainerContent className="gap-5 p-4">
          {/* Empty state with suggestions */}
          {isEmpty && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
              <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1">How can I help?</p>
                <p className="text-xs text-muted-foreground max-w-[260px]">
                  Ask about Slack, GitHub, meetings, or upload documents for AI analysis.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-[320px] mt-2">
                {SUGGESTIONS.map((s) => (
                  <PromptSuggestion
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="border-border text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5"
                  >
                    {s}
                  </PromptSuggestion>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {allMessages.map((msg, idx) => (
            <ChatMessageItem
              key={msg.id}
              message={msg}
              isStreaming={msg.id === "streaming"}
              isLastAssistant={
                !isStreaming &&
                msg.role === "assistant" &&
                idx === allMessages.length - 1
              }
              onPin={() => handleTogglePin(msg.id)}
              onBranch={() => handleBranch(msg.id)}
              onRegenerate={handleRegenerate}
              onEdit={msg.role === "user" && msg.id !== "optimistic-user" ? (newContent) => handleEditMessage(msg.id, newContent) : undefined}
              isEditing={editingMessageId === msg.id}
              onStartEdit={msg.role === "user" && msg.id !== "optimistic-user" ? () => setEditingMessageId(msg.id) : undefined}
              onCancelEdit={() => setEditingMessageId(null)}
              toolResults={messageToolResults}
            />
          ))}

          {/* Streaming: Plan card showing execution steps */}
          {isStreaming && planSteps.length > 0 && (
            <PlanCard steps={planSteps} />
          )}

          {/* Streaming: Chain-of-thought reasoning trace */}
          {isStreaming && thoughts.length > 0 && (
            <div className="ml-11">
              <Reasoning isStreaming={isStreaming}>
                <ReasoningTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Thinking ({thoughts.length} steps)
                </ReasoningTrigger>
                <ReasoningContent className="mt-1" contentClassName="text-xs leading-relaxed">
                  <ul className="space-y-1 list-none p-0 m-0">
                    {thoughts.map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-primary/60 shrink-0">›</span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </ReasoningContent>
              </Reasoning>
            </div>
          )}

          {/* Streaming: Tool use displays */}
          {isStreaming && streamingToolParts.length > 0 && (
            <div className="ml-11 space-y-1">
              {streamingToolParts.map((tp, i) => (
                <Tool key={tp.toolCallId || i} toolPart={tp} className="border-border" />
              ))}
            </div>
          )}

          {/* Receipts — shown after tool completions */}
          {receipts.length > 0 && (
            <div className="ml-11 flex flex-wrap gap-2">
              {receipts.map((r, i) => (
                <ReceiptBadge key={`receipt-${i}`} receipt={r} />
              ))}
            </div>
          )}

          {/* Action cards from backend */}
          {actionCards.map((card, i) => (
            <ActionCard
              key={`action-${i}`}
              data={card}
              onAction={(label) => {
                // Action cards can trigger a follow-up message
                if (label) sendMessage(`Proceed with: ${label}`);
              }}
            />
          ))}

          {/* Streaming: Thinking shimmer indicator */}
          {isStreaming && !streamingContent && thoughts.length === 0 && (
            <div className="ml-11 flex items-center gap-3">
              <TextShimmer
                as="span"
                className="text-sm"
                duration={3}
                spread={15}
              >
                Thinking...
              </TextShimmer>
              <ThinkingBar text="" onStop={handleStop} />
            </div>
          )}

          {/* Approval card */}
          {pendingApproval && (
            <ApprovalCard
              action={pendingApproval.action}
              details={pendingApproval.details}
              onApprove={() => handleApproval(true)}
              onReject={() => handleApproval(false)}
            />
          )}

          {/* Stream error with retry */}
          {streamError && !isStreaming && (
            <div className="ml-11 space-y-2">
              <SystemMessage variant="error" fill>
                {streamError}
              </SystemMessage>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  setStreamError(null);
                  const lastUserMsg = [...(sessionDetail?.messages || [])].reverse().find((m) => m.role === "user");
                  if (lastUserMsg) sendMessage(lastUserMsg.content);
                }}
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </Button>
            </div>
          )}

          <ChatContainerScrollAnchor />
        </ChatContainerContent>

        {/* Scroll-to-bottom button (auto-hides when at bottom via StickToBottom context) */}
        <div className="absolute bottom-2 right-3 z-10">
          <ScrollButton className="shadow-lg border-border bg-card text-muted-foreground hover:text-foreground" />
        </div>
      </ChatContainerRoot>

      {/* ── Input ────────────────────────────────────────────────────── */}
      <ChatInput
        onSend={sendMessage}
        onStop={handleStop}
        isStreaming={isStreaming}
        disabled={!!pendingApproval}
        focusedTab={activeTab}
      />
    </motion.div>
  );
}
