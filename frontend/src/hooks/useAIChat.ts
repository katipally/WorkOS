/**
 * useAIChat — encapsulates all SSE streaming, message sending, and approval logic.
 *
 * Extracted from AIPanel.tsx to keep the component focused on rendering.
 * This hook manages:
 *  - Streaming state (content, thoughts, tools, plans, receipts)
 *  - SSE event parsing for chat and approval flows
 *  - Retry logic with exponential backoff
 *  - Optimistic user messages
 *  - Message edit → branch → re-send flow
 *  - Regeneration
 *  - Pin toggling
 */

import { useCallback, useState, useRef, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/store/useAppStore";
import { aiApi, settingsApi } from "@/api/client";
import type { ChatSession } from "@/types";
import type { PlanStep } from "../components/ai/PlanCard";
import type { ReceiptData } from "../components/ai/ReceiptBadge";
import type { ActionCardData } from "../components/ai/ActionCard";

/* ─────────────────────── types ──────────────────────────────────── */
export interface StreamingToolUse {
    tool: string;
    input: Record<string, unknown>;
    id?: string;
}
export interface StreamingToolResult {
    tool: string;
    output: unknown;
    id?: string;
}

/* ─────────────────────── config ─────────────────────────────────── */
const MAX_RETRY = 3;
const RETRY_BASE_MS = 1500;

/* ─────────────────────── tab-aware suggestions ──────────────────── */
const TAB_SUGGESTIONS: Record<string, string[]> = {
    slack: [
        "Summarize recent Slack activity",
        "Find messages mentioning me",
        "Who's been most active today?",
        "List all Slack channels",
    ],
    github: [
        "What open PRs need review?",
        "Find issues assigned to me",
        "Show recent commits across repos",
        "Summarize latest CI/CD results",
    ],
    meetings: [
        "Show action items from last meeting",
        "Summarize this week's meetings",
        "What decisions were made recently?",
        "Find meetings about the roadmap",
    ],
    settings: [
        "Show my current AI configuration",
        "Check which integrations are connected",
        "Test my OpenAI connection",
        "List available models",
    ],
};

/* ═══════════════════════ hook ═══════════════════════════════════ */
export function useAIChat() {
    const {
        aiPanelOpen,
        activeTab,
        currentChatSessionId,
        setCurrentChatSessionId,
        aiScope: scope,
        setAIScope: setScope,
        selectedRepo,
        selectedSlackChannel,
    } = useAppStore();

    const queryClient = useQueryClient();

    /* ─── Streaming state ──────────────────────────────────────────── */
    const [streamingContent, setStreamingContent] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [thoughts, setThoughts] = useState<string[]>([]);
    const [toolUses, setToolUses] = useState<StreamingToolUse[]>([]);
    const [toolResults, setToolResults] = useState<StreamingToolResult[]>([]);
    const [pendingApproval, setPendingApproval] = useState<{
        action: string;
        details: Record<string, unknown>;
    } | null>(null);
    const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
    const [receipts, setReceipts] = useState<ReceiptData[]>([]);
    const [actionCards, setActionCards] = useState<ActionCardData[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    const [streamError, setStreamError] = useState<string | null>(null);
    const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [showModelPicker, setShowModelPicker] = useState(false);
    // Persist reasoning/thoughts per message (keyed by message ID)
    const [messageThoughts, setMessageThoughts] = useState<Map<string, string[]>>(new Map());

    const abortRef = useRef<AbortController | null>(null);
    const retryCountRef = useRef(0);
    const mountedRef = useRef(true);
    const thoughtsRef = useRef<string[]>([]);

    /* ─── Keyboard shortcut: Cmd/Ctrl+L ────────────────────────────── */
    const { setAIPanelOpen } = useAppStore();
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "l") {
                e.preventDefault();
                if (!aiPanelOpen) {
                    setAIPanelOpen(true);
                } else {
                    const ta = document.querySelector<HTMLTextAreaElement>("[data-ai-input]");
                    ta?.focus();
                }
            }
            if (
                e.key === "Escape" &&
                aiPanelOpen &&
                !document.querySelector("[data-radix-popper-content-wrapper]")
            ) {
                setAIPanelOpen(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [aiPanelOpen, setAIPanelOpen]);

    /* ─── Online/offline detection ──────────────────────────────────── */
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

    /* ─── Close model picker on outside click ──────────────────────── */
    useEffect(() => {
        if (!showModelPicker) return;
        const handler = (e: MouseEvent) => {
            if (!(e.target as Element).closest("[data-model-picker]")) {
                setShowModelPicker(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showModelPicker]);

    /* ─── Cleanup on unmount ────────────────────────────────────────── */
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            abortRef.current?.abort();
        };
    }, []);

    /* ─── Suggestions ───────────────────────────────────────────────── */
    const suggestions = useMemo(
        () => TAB_SUGGESTIONS[activeTab] ?? TAB_SUGGESTIONS.slack,
        [activeTab],
    );

    /* ─── Queries ───────────────────────────────────────────────────── */
    const { data: aiSettings } = useQuery({
        queryKey: ["ai-settings"],
        queryFn: settingsApi.getAI,
        enabled: aiPanelOpen,
        staleTime: 60_000,
    });

    const { data: availableModels } = useQuery({
        queryKey: ["ai-models", aiSettings?.ai_provider],
        queryFn: () => settingsApi.listModels(aiSettings!.ai_provider, "chat"),
        enabled: !!aiSettings?.ai_provider && showModelPicker,
        staleTime: 120_000,
    });

    const switchModel = useMutation({
        mutationFn: (modelId: string) => settingsApi.updateAI({ ai_model: modelId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
            setShowModelPicker(false);
        },
    });

    const { data: sessionDetail, error: sessionError } = useQuery({
        queryKey: ["ai-session", currentChatSessionId],
        queryFn: () => aiApi.getSession(currentChatSessionId!),
        enabled: !!currentChatSessionId && aiPanelOpen,
        retry: 1,
    });

    const isSessionStale = !!(
        sessionError && (sessionError as any)?.response?.status === 404
    );

    useEffect(() => {
        if (isSessionStale && currentChatSessionId) {
            setCurrentChatSessionId(null);
        }
    }, [isSessionStale, currentChatSessionId, setCurrentChatSessionId]);

    /* ─── Reset streaming state ─────────────────────────────────────── */
    const resetStreamingState = useCallback(() => {
        setStreamingContent("");
        setOptimisticUserMsg(null);
        setThoughts([]);
        setToolUses([]);
        setToolResults([]);
        setPlanSteps([]);
        setReceipts([]);
        setActionCards([]);
        setPendingApproval(null);
        setStreamError(null);
        setIsStreaming(false);
        setEditingMessageId(null);
    }, []);

    /* ─── SSE event dispatcher (shared between chat and approval) ──── */
    const dispatchSSE = useCallback(
        async (eventType: string, data: any, fullContentRef: { current: string }) => {
            switch (eventType) {
                case "token":
                    if (typeof data.content === "string") {
                        fullContentRef.current += data.content;
                        setStreamingContent(fullContentRef.current);
                    }
                    break;

                case "thought":
                    if (data.step) {
                        thoughtsRef.current = [...thoughtsRef.current, data.step];
                        setThoughts(thoughtsRef.current);
                    }
                    break;

                case "plan_step":
                    if (data.id != null) {
                        setPlanSteps((prev) => {
                            const existing = prev.findIndex((s) => s.id === data.id);
                            if (existing >= 0) {
                                const updated = [...prev];
                                updated[existing] = { ...updated[existing], ...data };
                                return updated;
                            }
                            if (data.label) {
                                return [
                                    ...prev,
                                    {
                                        id: data.id,
                                        label: data.label,
                                        tool: data.tool,
                                        status: data.status || "pending",
                                    },
                                ];
                            }
                            return prev;
                        });
                    }
                    break;

                case "tool_use":
                    if (data.tool && data.input) {
                        setToolUses((prev) => [
                            ...prev,
                            { tool: data.tool, input: data.input, id: data.id },
                        ]);
                        setPlanSteps((prev) =>
                            prev.map((s) =>
                                s.tool === data.tool && s.status === "pending"
                                    ? { ...s, status: "running" }
                                    : s,
                            ),
                        );
                    }
                    break;

                case "tool_result":
                    if (data.tool && "output" in data) {
                        setToolResults((prev) => [
                            ...prev,
                            { tool: data.tool, output: data.output, id: data.id },
                        ]);
                        setPlanSteps((prev) =>
                            prev.map((s) =>
                                s.tool === data.tool && s.status === "running"
                                    ? { ...s, status: "done" }
                                    : s,
                            ),
                        );
                    }
                    break;

                case "receipt":
                    if (data.tool && data.action) {
                        setReceipts((prev) => [
                            ...prev,
                            {
                                tool: data.tool,
                                action: data.action,
                                summary: data.summary || "",
                                success: data.success !== false,
                                link: data.link,
                            },
                        ]);
                    }
                    break;

                case "action_card":
                    if (data.type && data.title) {
                        setActionCards((prev) => [
                            ...prev,
                            {
                                type: data.type,
                                title: data.title,
                                description: data.description,
                                actions: data.actions,
                                metadata: data.metadata,
                            },
                        ]);
                    }
                    break;

                case "approval":
                    if (data.action && data.details) {
                        setPendingApproval({ action: data.action, details: data.details });
                    }
                    break;

                case "session":
                    if (data.session_id) {
                        setCurrentChatSessionId(data.session_id);
                    }
                    break;

                case "done": {
                    // Persist thoughts for this message before clearing
                    const doneMessageId = data.message_id;
                    if (doneMessageId && thoughtsRef.current.length > 0) {
                        const capturedThoughts = [...thoughtsRef.current];
                        setMessageThoughts((prev) => {
                            const newMap = new Map(prev);
                            newMap.set(doneMessageId, capturedThoughts);
                            return newMap;
                        });
                    }
                    await queryClient.invalidateQueries({
                        queryKey: [
                            "ai-session",
                            data.session_id || currentChatSessionId,
                        ],
                    });
                    await queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                    thoughtsRef.current = [];
                    resetStreamingState();
                    break;
                }

                case "error":
                    if (data.message) setStreamError(data.message);
                    break;

                default:
                    // Backward-compat: infer event type from data shape
                    if ("content" in data && typeof data.content === "string") {
                        fullContentRef.current += data.content;
                        setStreamingContent(fullContentRef.current);
                    } else if ("step" in data) {
                        thoughtsRef.current = [...thoughtsRef.current, data.step];
                        setThoughts(thoughtsRef.current);
                    } else if ("tool" in data && "input" in data) {
                        setToolUses((prev) => [
                            ...prev,
                            { tool: data.tool, input: data.input, id: data.id },
                        ]);
                    } else if ("tool" in data && "output" in data) {
                        setToolResults((prev) => [
                            ...prev,
                            { tool: data.tool, output: data.output, id: data.id },
                        ]);
                    } else if ("action" in data && "details" in data) {
                        setPendingApproval({ action: data.action, details: data.details });
                    } else if ("session_id" in data && !("message_id" in data)) {
                        if (data.session_id) setCurrentChatSessionId(data.session_id);
                    } else if ("message_id" in data) {
                        // Persist thoughts (backward-compat path)
                        if (data.message_id && thoughtsRef.current.length > 0) {
                            const capturedThoughts = [...thoughtsRef.current];
                            setMessageThoughts((prev) => {
                                const newMap = new Map(prev);
                                newMap.set(data.message_id, capturedThoughts);
                                return newMap;
                            });
                        }
                        await queryClient.invalidateQueries({
                            queryKey: [
                                "ai-session",
                                data.session_id || currentChatSessionId,
                            ],
                        });
                        await queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                        thoughtsRef.current = [];
                        resetStreamingState();
                    } else if ("message" in data) {
                        setStreamError(data.message);
                    }
                    break;
            }
        },
        [currentChatSessionId, queryClient, resetStreamingState, setCurrentChatSessionId],
    );

    /* ─── Read SSE stream ──────────────────────────────────────────── */
    const readSSEStream = useCallback(
        async (response: Response, fullContentRef: { current: string }) => {
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let currentEventType = "message";

            const processLine = async (line: string) => {
                if (line.startsWith("event: ")) {
                    currentEventType = line.slice(7).trim();
                    return;
                }
                if (
                    line.startsWith("id:") ||
                    line.startsWith("retry:") ||
                    line.trim() === ""
                )
                    return;
                if (!line.startsWith("data: ")) return;

                const dataStr = line.slice(6);
                try {
                    const data = JSON.parse(dataStr);
                    await dispatchSSE(currentEventType, data, fullContentRef);
                    currentEventType = "message";
                } catch {
                    // skip non-JSON lines
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!mountedRef.current) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    await processLine(line);
                }
            }

            // Process any remaining data in the buffer after stream ends
            if (buffer.trim()) {
                await processLine(buffer);
            }
        },
        [dispatchSSE],
    );

    /* ─── Send message ─────────────────────────────────────────────── */
    const sendMessage = useCallback(
        async (message: string, _retry = 0) => {
            if (!message.trim() || isStreaming) return;
            if (!isOnline) {
                setStreamError("You are offline. Please check your connection.");
                return;
            }

            setIsStreaming(true);
            setStreamingContent("");
            setThoughts([]);
            thoughtsRef.current = [];
            setToolUses([]);
            setToolResults([]);
            setPlanSteps([]);
            setReceipts([]);
            setActionCards([]);
            setPendingApproval(null);
            setStreamError(null);
            setOptimisticUserMsg(message.trim());
            setEditingMessageId(null);

            const controller = new AbortController();
            abortRef.current = controller;

            const mentionMap: Record<string, string> = {
                slack: "slack",
                github: "github",
                meetings: "meetings",
            };
            const contextMentions = [...message.matchAll(/@(\w+)/g)]
                .map((m) => mentionMap[m[1].toLowerCase()])
                .filter(Boolean);

            const fullContentRef = { current: "" };

            try {
                const validSessionId =
                    currentChatSessionId && !isSessionStale
                        ? currentChatSessionId
                        : null;

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
                        selected_repo: selectedRepo !== "__none__" ? selectedRepo : null,
                        selected_channel: selectedSlackChannel?.id ?? null,
                        selected_channel_name: selectedSlackChannel?.name ?? null,
                    }),
                    signal: controller.signal,
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (!response.body) throw new Error("No response body");

                retryCountRef.current = 0;
                await readSSEStream(response, fullContentRef);
            } catch (err: unknown) {
                if ((err as Error).name === "AbortError") {
                    // User-initiated abort
                } else if (_retry < MAX_RETRY && mountedRef.current) {
                    retryCountRef.current = _retry + 1;
                    const delay = RETRY_BASE_MS * Math.pow(2, _retry);
                    setStreamError(
                        `Connection lost. Retrying in ${Math.round(delay / 1000)}s... (${_retry + 1}/${MAX_RETRY})`,
                    );
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
                    setIsStreaming(false);
                    abortRef.current = null;
                }
            }
        },
        [
            currentChatSessionId,
            activeTab,
            scope,
            sessionDetail,
            isSessionStale,
            isStreaming,
            isOnline,
            readSSEStream,
            setCurrentChatSessionId,
            selectedRepo,
            selectedSlackChannel,
        ],
    );

    /* ─── Stop ──────────────────────────────────────────────────────── */
    const handleStop = useCallback(() => {
        abortRef.current?.abort();
        if (currentChatSessionId) aiApi.stopGeneration(currentChatSessionId);
    }, [currentChatSessionId]);

    /* ─── Approval ──────────────────────────────────────────────────── */
    const handleApproval = useCallback(
        async (approved: boolean) => {
            if (!currentChatSessionId) return;
            setPendingApproval(null);
            setIsStreaming(true);
            setStreamingContent("");
            setThoughts([]);
            thoughtsRef.current = [];
            setToolUses([]);
            setToolResults([]);
            setPlanSteps([]);
            setReceipts([]);
            setActionCards([]);
            setStreamError(null);

            const controller = new AbortController();
            abortRef.current = controller;
            const fullContentRef = { current: "" };

            try {
                const response = await fetch("/api/ai/approve", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        session_id: currentChatSessionId,
                        approved,
                    }),
                    signal: controller.signal,
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                if (!response.body) throw new Error("No response body");

                await readSSEStream(response, fullContentRef);
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
        },
        [currentChatSessionId, readSSEStream],
    );

    /* ─── New chat ──────────────────────────────────────────────────── */
    const handleNewChat = useCallback(() => {
        setCurrentChatSessionId(null);
        resetStreamingState();
        setPendingApproval(null);
        setShowHistory(false);
        setStreamError(null);
    }, [setCurrentChatSessionId, resetStreamingState]);

    /* ─── Toggle pin ────────────────────────────────────────────────── */
    const handleTogglePin = useCallback(
        async (messageId: string) => {
            if (!currentChatSessionId) return;
            await aiApi.togglePin(currentChatSessionId, messageId);
            queryClient.invalidateQueries({
                queryKey: ["ai-session", currentChatSessionId],
            });
        },
        [currentChatSessionId, queryClient],
    );

    /* ─── Select session ────────────────────────────────────────────── */
    const handleSelectSession = useCallback(
        (session: ChatSession) => {
            setCurrentChatSessionId(session.id);
            setShowHistory(false);
            setStreamingContent("");
            setStreamError(null);
            setPlanSteps([]);
            setReceipts([]);
            setActionCards([]);
        },
        [setCurrentChatSessionId],
    );

    /* ─── Edit message ──────────────────────────────────────────────── */
    const handleEditMessage = useCallback(
        async (messageId: string, newContent: string) => {
            if (!currentChatSessionId || isStreaming) return;
            try {
                const branchResult = await aiApi.createBranch(
                    currentChatSessionId,
                    messageId,
                );
                queryClient.setQueryData(
                    ["ai-session", currentChatSessionId],
                    (old: any) => {
                        if (!old) return old;
                        return {
                            ...old,
                            branch_id: branchResult.branch_id,
                            max_branch: branchResult.max_branch,
                        };
                    },
                );
                queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
                setEditingMessageId(null);
                await sendMessage(newContent);
            } catch {
                setStreamError("Failed to edit message. Please try again.");
            }
        },
        [currentChatSessionId, isStreaming, queryClient, sendMessage],
    );

    /* ─── Branch ────────────────────────────────────────────────────── */
    const handleBranch = useCallback(
        async (fromMessageId: string) => {
            if (!currentChatSessionId) return;
            try {
                await aiApi.createBranch(currentChatSessionId, fromMessageId);
                queryClient.invalidateQueries({
                    queryKey: ["ai-session", currentChatSessionId],
                });
                queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
            } catch {
                /* ignore */
            }
        },
        [currentChatSessionId, queryClient],
    );

    /* ─── Regenerate ────────────────────────────────────────────────── */
    const handleRegenerate = useCallback(async () => {
        if (!sessionDetail || !currentChatSessionId || isStreaming) return;
        const lastUserMsg = [...sessionDetail.messages]
            .reverse()
            .find((m) => m.role === "user");
        if (!lastUserMsg) return;
        try {
            const branchResult = await aiApi.createBranch(
                currentChatSessionId,
                lastUserMsg.id,
            );
            queryClient.setQueryData(
                ["ai-session", currentChatSessionId],
                (old: any) => {
                    if (!old) return old;
                    return {
                        ...old,
                        branch_id: branchResult.branch_id,
                        max_branch: branchResult.max_branch,
                    };
                },
            );
            queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
            await sendMessage(lastUserMsg.content);
        } catch {
            setStreamError("Failed to regenerate. Please try again.");
        }
    }, [sessionDetail, currentChatSessionId, isStreaming, sendMessage, queryClient]);

    /* ─── Build tool result lookup ──────────────────────────────────── */
    const messageToolResults = useMemo(() => {
        const map = new Map<
            string,
            { output?: Record<string, unknown>; error?: string }
        >();
        const msgs = sessionDetail?.messages || [];
        for (const m of msgs) {
            if (m.role === "tool" && m.tool_name) {
                const toolCallId = (m.metadata as Record<string, unknown>)
                    ?.tool_call_id as string;
                try {
                    const parsed = JSON.parse(m.content);
                    if (toolCallId) map.set(toolCallId, { output: parsed });
                    map.set(m.id, { output: parsed });
                } catch {
                    const output = { result: m.content };
                    if (toolCallId) map.set(toolCallId, { output });
                    map.set(m.id, { output });
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

    /* ─── Build streaming tool parts ────────────────────────────────── */
    const streamingToolParts = useMemo(() => {
        return toolUses.map((tu) => {
            const result = toolResults.find(
                (tr) => tr.id === tu.id || tr.tool === tu.tool,
            );
            return {
                type: tu.tool.replace(/_/g, " "),
                state: result
                    ? ("output-available" as const)
                    : ("input-streaming" as const),
                input: tu.input,
                output: result?.output as Record<string, unknown> | undefined,
                toolCallId: tu.id,
            };
        });
    }, [toolUses, toolResults]);

    /* ─── Derived ───────────────────────────────────────────────────── */
    const messages = sessionDetail?.messages || [];
    const allMessages = useMemo(() => {
        const base = [...messages];
        if (optimisticUserMsg) {
            const alreadyPresent = base.some(
                (m) => m.role === "user" && m.content === optimisticUserMsg,
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
        return base;
    }, [messages, optimisticUserMsg, sessionDetail?.branch_id]);

    const modelLabel = aiSettings ? aiSettings.ai_model || "default" : null;
    const providerLabel =
        aiSettings?.ai_provider === "ollama" ? "Ollama" : "OpenAI";

    // Detect reasoning-capable models from name pattern
    const isReasoningModel = useMemo(() => {
        const model = (aiSettings?.ai_model || "").toLowerCase();
        return /^(o1|o3|o4|gpt-5|gpt5|deepseek-r1|claude-3\.5-opus|claude-4)/.test(model)
            || model.includes("reasoning")
            || model.includes("think");
    }, [aiSettings?.ai_model]);
    const isEmpty = allMessages.length === 0 && !isStreaming;

    return {
        // State
        streamingContent,
        isStreaming,
        thoughts,
        toolUses,
        toolResults,
        pendingApproval,
        planSteps,
        receipts,
        actionCards,
        showHistory,
        setShowHistory,
        streamError,
        setStreamError,
        isOnline,
        editingMessageId,
        setEditingMessageId,
        showModelPicker,
        setShowModelPicker,

        // Queries
        aiSettings,
        availableModels,
        switchModel,
        sessionDetail,

        // Derived
        allMessages,
        suggestions,
        messageToolResults,
        messageThoughts,
        streamingToolParts,
        modelLabel,
        providerLabel,
        isReasoningModel,
        isEmpty,
        scope,
        setScope,
        activeTab,

        // Handlers
        sendMessage,
        handleStop,
        handleApproval,
        handleNewChat,
        handleTogglePin,
        handleSelectSession,
        handleEditMessage,
        handleBranch,
        handleRegenerate,
    };
}
