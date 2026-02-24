import { useState, useRef, useCallback, useEffect } from "react";
import { Square, Paperclip, Loader2, Hash, Github, Video, ArrowUp, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { aiApi } from "@/api/client";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import type { Tab } from "@/types";

const CONTEXT_SOURCES = [
  { id: "slack", label: "Slack", icon: Hash, color: "text-emerald-500 dark:text-emerald-400" },
  { id: "github", label: "GitHub", icon: Github, color: "text-blue-500 dark:text-blue-400" },
  { id: "meetings", label: "Meetings", icon: Video, color: "text-violet-500 dark:text-violet-400" },
] as const;

interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
}

interface ChatInputProps {
  onSend: (message: string, uploadedFileIds?: string[]) => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  focusedTab?: Tab;
}

export function ChatInput({ onSend, onStop, isStreaming, disabled, focusedTab }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeMentions, setActiveMentions] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming || disabled) return;
    const fileIds = uploadedFiles.map((f) => f.id);
    onSend(input.trim(), fileIds.length > 0 ? fileIds : undefined);
    setInput("");
    setActiveMentions([]);
    setUploadedFiles([]);
    setShowMentionPicker(false);
  }, [input, onSend, isStreaming, disabled, uploadedFiles]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const atMatch = val.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1].toLowerCase());
      setShowMentionPicker(true);
    } else {
      setShowMentionPicker(false);
    }
    const mentions = [...val.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    setActiveMentions(mentions.filter((m) =>
      CONTEXT_SOURCES.some((s) => s.label.toLowerCase() === m)
    ));
  }, []);

  const insertMention = useCallback((_sourceId: string, sourceLabel: string) => {
    const newVal = input.replace(/@(\w*)$/, `@${sourceLabel} `);
    setInput(newVal);
    setShowMentionPicker(false);
    const mentions = [...newVal.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    setActiveMentions(mentions.filter((m) =>
      CONTEXT_SOURCES.some((s) => s.label.toLowerCase() === m)
    ));
  }, [input]);

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const result = await aiApi.uploadFile(file);
      toast.success(`Uploaded ${file.name}`);

      // Create preview URL for images
      let previewUrl: string | undefined;
      if (file.type.startsWith("image/")) {
        previewUrl = URL.createObjectURL(file);
      }

      setUploadedFiles((prev) => [...prev, {
        id: result.id || crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        previewUrl,
      }]);
      setInput((prev) => prev + (prev ? " " : "") + `[${file.name}]`);
    } catch {
      toast.error("Failed to upload file");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setUploadedFiles((prev) => {
      const file = prev.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
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

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "0px";
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollH, 160) + "px";
    }
  }, [input]);

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

  const tabPlaceholders: Record<string, string> = {
    slack: "Ask about Slack channels, messages, or users...",
    github: "Ask about repos, issues, PRs, or commits...",
    meetings: "Ask about meeting summaries or action items...",
    settings: "Ask about your configuration or integrations...",
  };
  const placeholder = isStreaming
    ? "Agent is working..."
    : focusedTab
      ? tabPlaceholders[focusedTab] || "Ask anything... type @ to mention context"
      : "Ask anything... type @ to mention context";

  const isImageFile = (type: string) => type.startsWith("image/");

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div
      className="px-3 pb-3 pt-1 shrink-0"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
            Drop file to add context
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Floating Input Pill ─────────────────────────────────── */}
      <div className="relative rounded-2xl bg-card/80 backdrop-blur-sm border border-border/60 shadow-lg shadow-black/5 dark:shadow-black/20 transition-all focus-within:border-primary/40 focus-within:shadow-primary/5">

        {/* File thumbnails strip */}
        <AnimatePresence>
          {uploadedFiles.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="flex gap-2 px-3 pt-3 pb-1 flex-wrap">
                {uploadedFiles.map((file) => (
                  <motion.div
                    key={file.id}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.8, opacity: 0 }}
                    className="relative group/file"
                  >
                    {isImageFile(file.type) && file.previewUrl ? (
                      <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-border/40">
                        <img
                          src={file.previewUrl}
                          alt={file.name}
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeFile(file.id)}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover/file:opacity-100 transition-opacity"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/60 border border-border/40 text-xs max-w-45">
                        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate text-foreground/80">{file.name}</span>
                        <span className="text-muted-foreground/60 shrink-0">{formatFileSize(file.size)}</span>
                        <button
                          onClick={() => removeFile(file.id)}
                          className="ml-auto shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active mention badges */}
        {activeMentions.length > 0 && (
          <div className="flex gap-1.5 px-3 pt-2">
            {activeMentions.map((m) => {
              const src = CONTEXT_SOURCES.find((s) => s.label.toLowerCase() === m);
              if (!src) return null;
              const Icon = src.icon;
              return (
                <span
                  key={src.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-[11px] text-primary"
                >
                  <Icon className="w-3 h-3" />
                  {src.label}
                </span>
              );
            })}
          </div>
        )}

        {/* @ mention picker */}
        <AnimatePresence>
          {showMentionPicker && filteredSources.length > 0 && (
            <motion.div
              data-mention-picker
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full mb-2 left-2 z-50 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-xl overflow-hidden min-w-45"
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

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          data-ai-input
          value={input}
          onChange={handleValueChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 px-4 pt-3 pb-1 outline-none min-h-10 max-h-40"
        />

        {/* Actions bar */}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg text-muted-foreground/60 hover:text-foreground"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isStreaming}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              aria-label="Upload file"
              onChange={handleFileInputChange}
              accept=".txt,.md,.pdf,.docx,.csv,.json,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.webm,.mkv,.avi,.mov"
            />
          </div>

          <div className="flex items-center gap-1">
            {isStreaming ? (
              <Button
                size="icon"
                variant="destructive"
                className="h-7 w-7 rounded-full"
                onClick={onStop}
              >
                <Square className="w-3 h-3" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-7 w-7 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-30"
                onClick={handleSubmit}
                disabled={!input.trim() || disabled}
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/50 mt-1.5 text-center">
        Work Agent may produce inaccurate information. Verify important details.
      </p>
    </div>
  );
}
