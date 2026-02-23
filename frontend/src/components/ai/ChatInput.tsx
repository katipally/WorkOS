import { useState, useRef, useCallback, useEffect } from "react";
import { Square, Paperclip, Loader2, Hash, Github, Video, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/api/client";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import type { Tab } from "@/types";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/prompt-kit/prompt-input";

const CONTEXT_SOURCES = [
  { id: "slack", label: "Slack", icon: Hash, color: "text-emerald-500 dark:text-emerald-400" },
  { id: "github", label: "GitHub", icon: Github, color: "text-blue-500 dark:text-blue-400" },
  { id: "meetings", label: "Meetings", icon: Video, color: "text-violet-500 dark:text-violet-400" },
] as const;

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  focusedTab?: Tab;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, focusedTab: _focusedTab }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeMentions, setActiveMentions] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming || disabled) return;
    onSend(input.trim());
    setInput("");
    setActiveMentions([]);
    setShowMentionPicker(false);
  }, [input, onSend, isStreaming, disabled]);

  const handleValueChange = useCallback((val: string) => {
    setInput(val);
    const atMatch = val.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase());
      setShowMentionPicker(true);
    } else {
      setShowMentionPicker(false);
    }
    // Track active mentions
    const mentions = [...val.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    setActiveMentions(mentions.filter((m) =>
      CONTEXT_SOURCES.some((s) => s.label.toLowerCase() === m)
    ));
  }, []);

  const insertMention = useCallback((_sourceId: string, sourceLabel: string) => {
    const newVal = input.replace(/@(\w*)$/, `@${sourceLabel} `);
    setInput(newVal);
    setShowMentionPicker(false);
    // Update active mentions
    const mentions = [...newVal.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    setActiveMentions(mentions.filter((m) =>
      CONTEXT_SOURCES.some((s) => s.label.toLowerCase() === m)
    ));
  }, [input]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      await aiApi.uploadFile(file);
      toast.success(`Uploaded ${file.name}`);
      setInput((prev) => prev + (prev ? " " : "") + `[${file.name}]`);
    } catch {
      toast.error("Failed to upload file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  }, [uploadFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await uploadFile(file);
  }, [uploadFile]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-mention-picker]")) {
        setShowMentionPicker(false);
      }
    };
    if (showMentionPicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showMentionPicker]);

  const filteredSources = CONTEXT_SOURCES.filter(
    (s) => s.label.toLowerCase().startsWith(mentionQuery)
  );

  return (
    <div
      className="px-3 pb-3 pt-2 shrink-0 border-t border-border/50"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Active mention badges */}
      {activeMentions.length > 0 && (
        <div className="flex gap-1.5 mb-2 px-1">
          {activeMentions.map((m) => {
            const src = CONTEXT_SOURCES.find((s) => s.label.toLowerCase() === m);
            if (!src) return null;
            const Icon = src.icon;
            return (
              <span
                key={src.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted border border-border text-[11px] text-foreground/80"
              >
                <Icon className={`w-3 h-3 ${src.color}`} />
                {src.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Drop overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center justify-center py-4 mb-2 rounded-xl border-2 border-dashed border-primary/50 bg-primary/5 text-primary text-xs gap-2"
          >
            <Paperclip className="w-4 h-4" />
            Drop file to add to AI context
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        {/* @ mention picker */}
        <AnimatePresence>
          {showMentionPicker && filteredSources.length > 0 && (
            <motion.div
              data-mention-picker
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full mb-1.5 left-2 z-50 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-xl overflow-hidden min-w-[180px]"
            >
              <p className="text-[10px] text-muted-foreground px-3 pt-2 pb-1 font-medium uppercase tracking-wider">Mention context</p>
              {filteredSources.map((src) => {
                const Icon = src.icon;
                return (
                  <button
                    key={src.id}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-accent text-sm text-foreground transition-colors"
                    onMouseDown={(e) => { e.preventDefault(); insertMention(src.id, src.label); }}
                  >
                    <Icon className={`w-4 h-4 ${src.color}`} />
                    <span>{src.label}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

        <PromptInput
          value={input}
          onValueChange={handleValueChange}
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          disabled={disabled}
          className="border-border bg-card shadow-sm focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30 transition-all"
        >
          <PromptInputTextarea
            placeholder={isStreaming ? "AI is thinking..." : "Ask anything... type @ to mention context"}
            className="text-sm text-foreground placeholder:text-muted-foreground"
          />
          <PromptInputActions className="justify-between">
            <div className="flex items-center gap-1">
              <PromptInputAction tooltip="Attach file">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || isStreaming}
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                </Button>
              </PromptInputAction>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                aria-label="Upload file for AI context"
                onChange={handleFileInputChange}
                accept=".txt,.md,.pdf,.docx,.csv,.json,.png,.jpg,.jpeg,.webp"
              />
            </div>

            <div className="flex items-center gap-1">
              {isStreaming ? (
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-8 w-8 rounded-full"
                  onClick={onStop}
                >
                  <Square className="w-3.5 h-3.5" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  className="h-8 w-8 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-30"
                  onClick={handleSubmit}
                  disabled={!input.trim() || disabled}
                >
                  <ArrowUp className="w-4 h-4" />
                </Button>
              )}
            </div>
          </PromptInputActions>
        </PromptInput>
      </div>

      <p className="text-[10px] text-muted-foreground/60 mt-2 text-center">
        AI may produce inaccurate information. Verify important details.
      </p>
    </div>
  );
}
