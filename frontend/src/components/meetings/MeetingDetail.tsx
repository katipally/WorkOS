import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Upload, Loader2, FileText, Mic, Film, Play, Trash2,
  CheckCircle2, Circle, Clock, Brain, User, Calendar, AlertCircle,
  ChevronDown, ChevronUp, Search, Copy, ListTree, Download, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { meetingsApi, settingsApi } from "@/api/client";
import type { Meeting, ActionItem } from "@/types";
import type { ReactNode } from "react";

interface MeetingDetailProps {
  meeting: Meeting;
  onBack: () => void;
  onDelete: () => void;
}

export function MeetingDetail({ meeting: initialMeeting, onBack, onDelete }: MeetingDetailProps) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("summary");

  // Fetch live meeting data (for processing updates)
  const { data: meeting = initialMeeting } = useQuery({
    queryKey: ["meeting", initialMeeting.id],
    queryFn: () => meetingsApi.get(initialMeeting.id),
    initialData: initialMeeting,
    refetchInterval: (query) => (query.state.data as Meeting | undefined)?.status === "processing" ? 3000 : false,
  });

  // Fetch AI settings to show which models will be used
  const { data: aiSettings } = useQuery({
    queryKey: ["ai-settings"],
    queryFn: settingsApi.getAI,
    staleTime: 60_000,
  });

  const processMutation = useMutation({
    mutationFn: () => meetingsApi.process(meeting.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("Processing started");
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => meetingsApi.uploadFile(meeting.id, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("File uploaded — starting processing…");
      // Auto-process after upload
      processMutation.mutate();
    },
    onError: () => toast.error("Upload failed"),
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => meetingsApi.deleteFile(meeting.id, fileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meeting", meeting.id] });
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      toast.success("File removed");
    },
    onError: () => toast.error("Failed to remove file"),
  });

  const onDrop = useCallback(
    (files: File[]) => {
      files.forEach((f) => uploadMutation.mutate(f));
    },
    [uploadMutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/*": [".txt", ".md", ".csv", ".vtt", ".srt"],
      "audio/*": [".mp3", ".wav", ".m4a", ".ogg", ".flac"],
      "video/*": [".mp4", ".webm", ".mkv", ".avi", ".mov"],
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    },
  });

  const isProcessing = meeting.status === "processing";
  const isReady = meeting.status === "ready";
  const hasFiles = meeting.files && meeting.files.length > 0;
  const summaryText = (meeting.summary || "").trim();
  const summarySections = useMemo(() => extractSummarySections(summaryText), [summaryText]);

  const summaryModelLabel = aiSettings
    ? `${aiSettings.meeting_summary_provider} / ${aiSettings.meeting_summary_model || "default"}`
    : null;
  const actionsModelLabel = aiSettings
    ? `${aiSettings.meeting_actions_provider} / ${aiSettings.meeting_actions_model || "default"}`
    : null;

  const getFileIcon = (filetype: string) => {
    switch (filetype) {
      case "audio": return <Mic className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />;
      case "video": return <Film className="w-4 h-4 text-blue-500 dark:text-blue-400" />;
      default: return <FileText className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{meeting.title}</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(meeting.meeting_date).toLocaleDateString()} • {meeting.files?.length || 0} files
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasFiles && !isProcessing && (
            <Button
              size="sm"
              className="text-xs"
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending}
            >
              {processMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Play className="w-4 h-4 mr-1" />
              )}
              {isReady ? "Reprocess" : "Process"}
            </Button>
          )}
          {isProcessing && (
            <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs gap-1 border-amber-500/30">
              <Loader2 className="w-3 h-3 animate-spin" /> Processing...
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Model info bar */}
      {(summaryModelLabel || actionsModelLabel) && (
        <div className="mx-6 mt-3 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground shrink-0">
          <Brain className="w-3 h-3 text-violet-500 dark:text-violet-400 shrink-0" />
          {summaryModelLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">Summary: <span className="text-foreground/70">{summaryModelLabel}</span></span>
              </TooltipTrigger>
              <TooltipContent>Model used to generate the meeting summary</TooltipContent>
            </Tooltip>
          )}
          {actionsModelLabel && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">Actions: <span className="text-foreground/70">{actionsModelLabel}</span></span>
              </TooltipTrigger>
              <TooltipContent>Model used to extract action items</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {/* File Upload Zone */}
      <div
        {...getRootProps()}
        className={`mx-6 mt-4 border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors shrink-0 ${isDragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-border/80 bg-muted/30"
          }`}
      >
        <input {...getInputProps()} />
        <Upload className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          {isDragActive
            ? "Drop files here..."
            : "Drag & drop transcripts, audio or video files"}
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Supports: TXT, MD, PDF, DOCX, MP3, WAV, MP4, WebM, and more
        </p>
      </div>

      {/* Uploaded Files */}
      {hasFiles && (
        <div className="mx-6 mt-3 flex flex-wrap gap-2 shrink-0">
          {meeting.files.map((f) => (
            <div key={f.id} className="flex items-center gap-1 border border-border rounded-full pl-2 pr-1 py-0.5 text-xs bg-card">
              {getFileIcon(f.filetype)}
              <span className="text-foreground/80 truncate max-w-35">{f.filename}</span>
              <span className="text-muted-foreground">({(f.filesize / 1024).toFixed(0)}KB)</span>
              {f.status === "processing" && <Loader2 className="w-3 h-3 animate-spin text-amber-500 dark:text-amber-400 ml-1" />}
              {f.status === "ready" && <CheckCircle2 className="w-3 h-3 text-emerald-500 dark:text-emerald-400 ml-1" />}
              <Button
                variant="ghost" size="icon"
                className="h-4 w-4 ml-0.5 hover:text-destructive"
                onClick={() => deleteFileMutation.mutate(f.id)}
                disabled={deleteFileMutation.isPending || isProcessing}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col mt-4 min-h-0">
        <TabsList className="mx-6 shrink-0">
          <TabsTrigger value="summary" className="text-xs">Summary</TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">Action Items</TabsTrigger>
          <TabsTrigger value="preview" className="text-xs">Preview</TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 min-h-0 px-6 py-4">
          <TabsContent value="summary" className="mt-0">
            {isProcessing && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-20 w-full mt-4" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-4 w-full" />
              </div>
            )}
            {!isProcessing && !meeting.summary && (
              <div className="text-center py-16">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No summary yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Upload files above — they are processed automatically.
                </p>
              </div>
            )}
            {meeting.summary && (
              <MeetingSummaryPanel
                meetingDate={meeting.meeting_date}
                fileCount={meeting.files?.length || 0}
                actionCount={meeting.action_items?.length || 0}
                summary={meeting.summary}
                actionItems={meeting.action_items || []}
                meetingTitle={meeting.title}
                sections={summarySections}
              />
            )}
          </TabsContent>

          <TabsContent value="actions" className="mt-0">
            {isProcessing && (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            )}
            {!isProcessing && (!meeting.action_items || meeting.action_items.length === 0) && (
              <div className="text-center py-16">
                <CheckCircle2 className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No action items yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Upload files above — action items are extracted automatically.
                </p>
              </div>
            )}
            {meeting.action_items && meeting.action_items.length > 0 && (
              <ActionItemsList items={meeting.action_items} />
            )}
          </TabsContent>

          <TabsContent value="preview" className="mt-0">
            {!hasFiles && (
              <div className="text-center py-16">
                <Upload className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No files uploaded</p>
              </div>
            )}
            {meeting.files?.map((f) => (
              <div key={f.id} className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  {getFileIcon(f.filetype)}
                  <span className="text-sm font-medium text-foreground">{f.filename}</span>
                  <Badge variant="outline" className="text-[10px]">{f.filetype}</Badge>
                  {f.status === "ready" && (
                    <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3 mr-1" /> Transcribed
                    </Badge>
                  )}
                </div>
                {f.transcription ? (
                  <TranscriptionView content={f.transcription} filename={f.filename} />
                ) : (
                  <p className="text-xs text-muted-foreground italic pl-6">
                    {f.status === "processing" ? (
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin" /> Transcribing...
                      </span>
                    ) : "No content available"}
                  </p>
                )}
              </div>
            ))}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

function ActionItemsList({ items }: { items: ActionItem[] }) {
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = items.filter((item) => {
    if (filter === "pending" && item.completed) return false;
    if (filter === "completed" && !item.completed) return false;
    if (searchQuery && !item.text.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !(item.assignee || "").toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const aOverdue = isOverdue(a.due_date);
      const bOverdue = isOverdue(b.due_date);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return 0;
    });
  }, [filtered]);

  const completedCount = items.filter((i) => i.completed).length;
  const pendingCount = items.length - completedCount;

  return (
    <div className="space-y-3">
      {/* Stats and filter bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] gap-1">
            <Circle className="w-2.5 h-2.5 text-amber-500" /> {pendingCount} pending
          </Badge>
          <Badge variant="outline" className="text-[10px] gap-1">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" /> {completedCount} done
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {(["all", "pending", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded-full capitalize transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search action items..."
          className="pl-8 h-8 text-xs bg-muted/50"
        />
      </div>
      {/* Items */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-6">No matching action items</p>
        )}
        {sorted.map((item, i) => (
          <ActionItemCard key={i} item={item} index={i + 1} />
        ))}
      </div>
    </div>
  );
}

function ActionItemCard({ item, index }: { item: ActionItem; index?: number }) {
  const overdue = isOverdue(item.due_date) && !item.completed;

  return (
    <Card className={`bg-card border-border transition-colors ${item.completed ? "opacity-60" : ""}`}>
      <CardContent className="p-3 flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {item.completed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          ) : (
            <Circle className="w-4 h-4 text-amber-500/60 dark:text-amber-400/60" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm text-foreground ${item.completed ? "line-through text-muted-foreground" : ""}`}>
            {index != null && <span className="text-muted-foreground mr-1.5 text-xs">#{index}</span>}
            {item.text}
          </p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {item.assignee && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                <User className="w-3 h-3" /> {item.assignee}
              </span>
            )}
            {item.due_date && (
              <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                overdue
                  ? "text-destructive bg-destructive/10"
                  : "text-muted-foreground bg-muted"
              }`}>
                <Clock className="w-3 h-3" /> {item.due_date}
              </span>
            )}
            {overdue && (
              <span className="inline-flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="w-3 h-3" /> Overdue
              </span>
            )}
            {!item.completed && !item.due_date && !item.assignee && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600/60 dark:text-amber-400/60">
                <AlertCircle className="w-3 h-3" /> Unassigned
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TranscriptionView({ content, filename }: { content: string; filename: string }) {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const maxLines = 20;
  const lines = content.split("\n");
  const isLong = lines.length > maxLines;
  const displayContent = expanded ? content : lines.slice(0, maxLines).join("\n");
  const displayedLines = displayContent.split("\n");

  // Detect if it looks like a timestamped transcript (VTT / SRT style)
  const hasTimestamps = /\d{1,2}:\d{2}/.test(content.slice(0, 500));
  const matchCount = searchQuery
    ? displayedLines.reduce((count, line) => count + countMatches(line, searchQuery), 0)
    : 0;
  const visibleText = displayedLines.join("\n");

  const copyVisible = async () => {
    try {
      await navigator.clipboard.writeText(visibleText);
      toast.success("Visible transcript copied");
    } catch {
      toast.error("Could not copy transcript");
    }
  };

  const downloadFullTranscript = () => {
    const safeName = filename.replace(/\.[^.]+$/, "") || "transcript";
    downloadTextFile(`${safeName}-transcript.txt`, content);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="bg-muted/50 px-3 py-1.5 flex items-center justify-between text-[11px] text-muted-foreground border-b border-border">
        <span className="flex items-center gap-1.5">
          <FileText className="w-3 h-3" />
          {filename}
          {hasTimestamps && <Badge variant="outline" className="text-[9px] py-0">timestamped</Badge>}
        </span>
        <div className="flex items-center gap-2">
          <span>{lines.length} lines</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copyVisible}>
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={downloadFullTranscript}>
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      <div className="px-3 py-2 border-b border-border bg-background/60">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        {searchQuery && (
          <p className="text-[10px] text-muted-foreground mt-1">
            {matchCount} match{matchCount === 1 ? "" : "es"} in visible lines
          </p>
        )}
      </div>
      <div className="p-4 text-xs text-foreground/80 whitespace-pre-wrap overflow-auto max-h-100 font-mono leading-relaxed">
        {hasTimestamps ? (
          displayedLines.map((line, i) => {
            const isTS = /^\d{1,2}:\d{2}/.test(line.trim());
            return (
              <div key={i} className={isTS ? "text-primary/60 mt-2 first:mt-0 font-semibold" : ""}>
                {highlightText(line, searchQuery)}
              </div>
            );
          })
        ) : (
          displayedLines.map((line, i) => (
            <div key={i}>{highlightText(line, searchQuery)}</div>
          ))
        )}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-primary hover:bg-muted/50 border-t border-border transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function MeetingSummaryPanel({
  meetingDate,
  fileCount,
  actionCount,
  summary,
  actionItems,
  meetingTitle,
  sections,
}: {
  meetingDate: string;
  fileCount: number;
  actionCount: number;
  summary: string;
  actionItems: ActionItem[];
  meetingTitle: string;
  sections: { title: string; level: number; slug: string }[];
}) {
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      toast.success("Summary copied");
    } catch {
      toast.error("Could not copy summary");
    }
  };

  const exportSummaryMarkdown = () => {
    const body = `# ${meetingTitle}\n\n## AI Summary\n\n${summary}\n`;
    downloadTextFile(`${slugify(meetingTitle) || "meeting"}-summary.md`, body);
  };

  const exportActionsJson = () => {
    const payload = {
      meeting_title: meetingTitle,
      meeting_date: meetingDate,
      exported_at: new Date().toISOString(),
      action_items: actionItems,
    };
    downloadTextFile(
      `${slugify(meetingTitle) || "meeting"}-actions.json`,
      JSON.stringify(payload, null, 2)
    );
  };

  const copyPendingActions = async () => {
    const pending = actionItems.filter((a) => !a.completed);
    const text = pending.length
      ? pending.map((a, i) => `${i + 1}. ${a.text}${a.assignee ? ` — @${a.assignee}` : ""}${a.due_date ? ` (due: ${a.due_date})` : ""}`).join("\n")
      : "No pending actions.";
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Pending actions copied");
    } catch {
      toast.error("Could not copy action items");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">AI Meeting Summary</p>
            <p className="text-[11px] text-muted-foreground">
              Auto-generated from uploaded files. Validate key decisions before sharing externally.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {new Date(meetingDate).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </span>
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {fileCount} source file{fileCount !== 1 ? "s" : ""}
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {actionCount} action item{actionCount !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap justify-end items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={copySummary}>
              <Copy className="w-3.5 h-3.5" /> Copy
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportSummaryMarkdown}>
              <Download className="w-3.5 h-3.5" /> .md
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={exportActionsJson}>
              <ClipboardList className="w-3.5 h-3.5" /> Actions JSON
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={copyPendingActions}>
              <Copy className="w-3.5 h-3.5" /> Pending
            </Button>
          </div>
        </div>
      </div>

      {sections.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
            <ListTree className="w-3 h-3" /> Sections
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sections.map((section) => (
              <a
                key={section.slug}
                href={`#${section.slug}`}
                className="text-[11px] rounded-full px-2 py-0.5 bg-muted hover:bg-muted/80 text-foreground/80"
              >
                {section.title}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="prose prose-sm dark:prose-invert max-w-none
        prose-headings:text-foreground prose-headings:font-semibold prose-headings:scroll-mt-24
        prose-h1:text-lg prose-h1:border-b prose-h1:border-border prose-h1:pb-2 prose-h1:mb-3
        prose-h2:text-base prose-h2:mt-5 prose-h2:mb-2
        prose-h3:text-sm prose-h3:mt-4 prose-h3:mb-1.5
        prose-p:text-sm prose-p:leading-relaxed prose-p:text-foreground/90
        prose-li:text-sm prose-li:text-foreground/90
        prose-strong:text-foreground
        prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => {
              const text = flattenNodeText(children);
              return <h1 id={slugify(text)}>{children}</h1>;
            },
            h2: ({ children }) => {
              const text = flattenNodeText(children);
              return <h2 id={slugify(text)}>{children}</h2>;
            },
            h3: ({ children }) => {
              const text = flattenNodeText(children);
              return <h3 id={slugify(text)}>{children}</h3>;
            },
          }}
        >
          {summary}
        </ReactMarkdown>
      </div>
    </div>
  );
}

function extractSummarySections(summary: string): { title: string; level: number; slug: string }[] {
  if (!summary) return [];
  const sections: { title: string; level: number; slug: string }[] = [];
  const lines = summary.split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (!match) continue;
    const level = match[1].length;
    const title = match[2].trim();
    if (!title) continue;
    sections.push({ title, level, slug: slugify(title) });
  }
  return sections;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function isOverdue(dueDate?: string): boolean {
  if (!dueDate) return false;
  const parsed = new Date(dueDate);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() < Date.now();
}

function countMatches(line: string, query: string): number {
  if (!query.trim()) return 0;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");
  const matches = line.match(regex);
  return matches ? matches.length : 0;
}

function highlightText(line: string, query: string) {
  if (!query.trim()) return line;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = line.split(regex);
  const queryLower = query.toLowerCase();
  return parts.map((part, idx) => (
    part.toLowerCase() === queryLower
      ? <mark key={idx} className="bg-amber-300/40 dark:bg-amber-500/30 text-foreground rounded px-0.5">{part}</mark>
      : <span key={idx}>{part}</span>
  ));
}

function flattenNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenNodeText).join(" ");
  if (node && typeof node === "object" && "props" in node) {
    return flattenNodeText((node as any).props?.children);
  }
  return "";
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
