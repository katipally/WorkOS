/**
 * AIPanelHeader — the top bar of the AI panel with controls for
 * scope, new chat, history, model picker, and close.
 */
import {
    Layers, Layout, Sparkles, WifiOff, Plus, X,
    ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { ContextBadge } from "./ContextBadge";
import { ChatGrid } from "./ChatGrid";
import { ExportButton } from "./RichContent";
import type { ChatSession, ChatSessionDetail, ModelInfo, AISettings, Tab } from "@/types";

interface AIPanelHeaderProps {
    activeTab: Tab;
    isOnline: boolean;
    scope: string;
    setScope: (scope: "workspace" | "tab") => void;
    sessionDetail: ChatSessionDetail | undefined;
    currentChatSessionId: string | null;
    onNewChat: () => void;
    showHistory: boolean;
    setShowHistory: (show: boolean) => void;
    onSelectSession: (session: ChatSession) => void;
    onClose: () => void;
    // Model picker
    modelLabel: string | null;
    providerLabel: string;
    showModelPicker: boolean;
    setShowModelPicker: (show: boolean) => void;
    availableModels: ModelInfo[] | undefined;
    aiSettings: AISettings | undefined;
    onSwitchModel: (modelId: string) => void;
}

export function AIPanelHeader({
    activeTab,
    isOnline,
    scope,
    setScope,
    sessionDetail,
    currentChatSessionId,
    onNewChat,
    showHistory,
    setShowHistory,
    onSelectSession,
    onClose,
    modelLabel,
    providerLabel,
    showModelPicker,
    setShowModelPicker,
    availableModels,
    aiSettings,
    onSwitchModel,
}: AIPanelHeaderProps) {
    return (
        <>
            {/* ── Header bar ───────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0 bg-background">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-primary/10">
                        <Sparkles className="w-4 h-4 text-primary" />
                    </div>
                    <span className="font-semibold text-sm text-foreground">Work Agent</span>
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
                                onClick={() => setScope(scope === "workspace" ? "tab" : "workspace")}
                            >
                                {scope === "workspace" ? <Layers className="w-3.5 h-3.5" /> : <Layout className="w-3.5 h-3.5" />}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{scope === "workspace" ? "Whole Workspace" : "This Tab Only"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" onClick={onNewChat}>
                                <Plus className="w-3.5 h-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>New Chat</TooltipContent>
                    </Tooltip>
                    <ChatGrid
                        open={showHistory}
                        onClose={() => setShowHistory(false)}
                        onSelectSession={onSelectSession}
                    />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={`h-7 w-7 rounded-lg ${showHistory ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}
                                onClick={() => setShowHistory(!showHistory)}
                            >
                                <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>History</TooltipContent>
                    </Tooltip>
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" onClick={onClose}>
                        <X className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </div>

            {/* ── Model picker + scope info ─────────────────────────── */}
            {(modelLabel || scope === "tab") && (
                <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/40 bg-muted/20 shrink-0">
                    {modelLabel && (
                        <div className="relative" data-model-picker>
                            <button
                                className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono truncate hover:text-foreground transition-colors rounded px-1.5 py-0.5 hover:bg-muted"
                                onClick={() => setShowModelPicker(!showModelPicker)}
                            >
                                <span className="text-[10px] text-muted-foreground/60">{providerLabel}</span>
                                <span className="text-foreground/80">{modelLabel}</span>
                                <ChevronDown className="w-3 h-3 text-muted-foreground" />
                            </button>

                            {showModelPicker && (
                                <div className="absolute top-full left-0 mt-1 z-50 w-64 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-xl">
                                    <p className="text-[10px] text-muted-foreground px-3 pt-2 pb-1 font-medium uppercase tracking-wider">
                                        Switch Model
                                    </p>
                                    {availableModels?.length ? (
                                        availableModels.map((m: ModelInfo) => (
                                            <button
                                                key={m.id}
                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors ${m.id === aiSettings?.ai_model ? "text-primary font-medium" : "text-foreground"}`}
                                                onClick={() => onSwitchModel(m.id)}
                                            >
                                                {m.id === aiSettings?.ai_model && <span className="text-primary">•</span>}
                                                <span className="truncate">{m.name}</span>
                                            </button>
                                        ))
                                    ) : (
                                        <p className="px-3 py-2 text-xs text-muted-foreground">Loading models...</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    <div className="flex-1" />
                    {scope === "tab" && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-border text-muted-foreground shrink-0">
                            Tab scope
                        </Badge>
                    )}
                </div>
            )}
        </>
    );
}
