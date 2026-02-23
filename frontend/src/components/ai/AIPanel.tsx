/**
 * AIPanel — main Work Agent side-panel.
 *
 * This component is a thin composition layer. All logic has been extracted:
 *  - SSE streaming, queries, handlers → useAIChat hook
 *  - Drag-resize → useResizePanel hook
 *  - Header bar → AIPanelHeader
 *  - Empty state → EmptyState
 *  - Streaming block → StreamingBlock
 */

import { motion } from "framer-motion";
import { GripVertical, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/useAppStore";
import { useAIChat } from "@/hooks/useAIChat";
import { useResizePanel } from "@/hooks/useResizePanel";
import { ChatMessageItem } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { SessionHeader } from "./SessionHeader";
import { ApprovalCard } from "./ApprovalCard";
import { ActionCard } from "./ActionCard";
import { AIPanelHeader } from "./AIPanelHeader";
import { EmptyState } from "./EmptyState";
import { StreamingBlock } from "./StreamingBlock";
import { SystemMessage } from "@/components/prompt-kit/system-message";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/prompt-kit/chat-container";
import { ScrollButton } from "@/components/prompt-kit/scroll-button";

export function AIPanel() {
  const { aiPanelOpen, setAIPanelOpen, currentChatSessionId } = useAppStore();
  const { aiPanelWidth, handleResizeStart } = useResizePanel();
  const chat = useAIChat();

  if (!aiPanelOpen) return null;

  /* Filter messages: skip tool-role messages (rendered inline) and
     avoid showing the last assistant message while streaming since
     StreamingBlock already renders it — this prevents the duplicate. */
  const visibleMessages = chat.allMessages.filter((msg) => {
    if (msg.role === "tool") return false;
    return true;
  });

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: aiPanelWidth, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative h-full border-l border-border flex flex-col overflow-hidden section-ai-panel ai-panel-mobile md:relative md:inset-auto md:z-auto"
      style={{ minWidth: 320, maxWidth: 800 }}
    >
      {/* ── Resize drag handle ───────────────────────────────────── */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 group/resize hover:bg-primary/10 transition-colors"
        onMouseDown={handleResizeStart}
      >
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center justify-center w-4 h-10 -ml-1.5 opacity-0 group-hover/resize:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3 text-muted-foreground" />
        </div>
      </div>

      {/* ── Header ───────────────────────────────────────────────── */}
      <AIPanelHeader
        activeTab={chat.activeTab}
        isOnline={chat.isOnline}
        scope={chat.scope}
        setScope={chat.setScope}
        sessionDetail={chat.sessionDetail}
        currentChatSessionId={currentChatSessionId}
        onNewChat={chat.handleNewChat}
        showHistory={chat.showHistory}
        setShowHistory={chat.setShowHistory}
        onSelectSession={chat.handleSelectSession}
        onClose={() => setAIPanelOpen(false)}
        modelLabel={chat.modelLabel}
        providerLabel={chat.providerLabel}
        showModelPicker={chat.showModelPicker}
        setShowModelPicker={chat.setShowModelPicker}
        availableModels={chat.availableModels}
        aiSettings={chat.aiSettings}
        onSwitchModel={(id) => chat.switchModel.mutate(id)}
      />

      {/* ── Session Header ───────────────────────────────────────── */}
      {currentChatSessionId && chat.sessionDetail && (
        <SessionHeader session={chat.sessionDetail} onBranch={chat.handleBranch} />
      )}

      {/* ── Chat Messages ────────────────────────────────────────── */}
      <ChatContainerRoot className="flex-1 min-h-0 relative">
        <ChatContainerContent className="gap-5 p-4">
          {/* Empty state */}
          {chat.isEmpty && (
            <EmptyState suggestions={chat.suggestions} onSend={chat.sendMessage} />
          )}

          {/* Message list */}
          {visibleMessages.map((msg, idx) => (
            <ChatMessageItem
              key={msg.id}
              message={msg}
              isStreaming={false}
              isLastAssistant={
                !chat.isStreaming &&
                msg.role === "assistant" &&
                idx === visibleMessages.length - 1
              }
              onPin={() => chat.handleTogglePin(msg.id)}
              onBranch={() => chat.handleBranch(msg.id)}
              onRegenerate={chat.handleRegenerate}
              onEdit={
                msg.role === "user" && msg.id !== "optimistic-user"
                  ? (newContent) => chat.handleEditMessage(msg.id, newContent)
                  : undefined
              }
              isEditing={chat.editingMessageId === msg.id}
              onStartEdit={
                msg.role === "user" && msg.id !== "optimistic-user"
                  ? () => chat.setEditingMessageId(msg.id)
                  : undefined
              }
              onCancelEdit={() => chat.setEditingMessageId(null)}
              toolResults={chat.messageToolResults}
              thoughts={msg.role === "assistant" ? chat.messageThoughts.get(msg.id) : undefined}
            />
          ))}

          {/* Streaming response */}
          <StreamingBlock
            isStreaming={chat.isStreaming}
            streamingContent={chat.streamingContent}
            thoughts={chat.thoughts}
            planSteps={chat.planSteps}
            streamingToolParts={chat.streamingToolParts}
            receipts={chat.receipts}
          />

          {/* Action cards */}
          {chat.actionCards.map((card, i) => (
            <ActionCard
              key={`action-${i}`}
              data={card}
              onAction={(label) => {
                if (label) chat.sendMessage(`Proceed with: ${label}`);
              }}
            />
          ))}

          {/* Approval card */}
          {chat.pendingApproval && (
            <ApprovalCard
              action={chat.pendingApproval.action}
              details={chat.pendingApproval.details}
              onApprove={() => chat.handleApproval(true)}
              onReject={() => chat.handleApproval(false)}
            />
          )}

          {/* Stream error */}
          {chat.streamError && !chat.isStreaming && (
            <div className="space-y-2">
              <SystemMessage variant="error" fill>
                {chat.streamError}
              </SystemMessage>
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => {
                  chat.setStreamError(null);
                  const lastUserMsg = [...(chat.sessionDetail?.messages || [])]
                    .reverse()
                    .find((m) => m.role === "user");
                  if (lastUserMsg) chat.sendMessage(lastUserMsg.content);
                }}
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </Button>
            </div>
          )}

          <ChatContainerScrollAnchor />
        </ChatContainerContent>

        <div className="absolute bottom-2 right-3 z-10">
          <ScrollButton className="shadow-lg border-border bg-card text-muted-foreground hover:text-foreground" />
        </div>
      </ChatContainerRoot>

      {/* ── Floating Input ────────────────────────────────────────── */}
      <ChatInput
        onSend={chat.sendMessage}
        onStop={chat.handleStop}
        isStreaming={chat.isStreaming}
        disabled={!!chat.pendingApproval}
        focusedTab={chat.activeTab}
      />
    </motion.div>
  );
}
