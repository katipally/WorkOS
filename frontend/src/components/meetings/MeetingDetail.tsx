import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft, Upload, Loader2, FileText, Mic, Film, Play, Trash2,
  CheckCircle2, Circle, Clock, Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { meetingsApi, settingsApi } from "@/api/client";
import type { Meeting, ActionItem } from "@/types";

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
              <span className="text-foreground/80 truncate max-w-[140px]">{f.filename}</span>
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
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{meeting.summary}</ReactMarkdown>
              </div>
            )}
          </TabsContent>

          <TabsContent value="actions" className="mt-0">
            {isProcessing && (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
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
              <div className="space-y-2">
                {meeting.action_items.map((item, i) => (
                  <ActionItemCard key={i} item={item} />
                ))}
              </div>
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
              <div key={f.id} className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  {getFileIcon(f.filetype)}
                  <span className="text-sm font-medium text-foreground">{f.filename}</span>
                  <Badge variant="outline" className="text-[10px]">{f.filetype}</Badge>
                </div>
                {f.transcription ? (
                  <pre className="bg-muted border border-border rounded-lg p-4 text-xs text-foreground/80 whitespace-pre-wrap overflow-auto max-h-96">
                    {f.transcription}
                  </pre>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    {f.status === "processing" ? "Transcribing..." : "No content available"}
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

function ActionItemCard({ item }: { item: ActionItem }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-3 flex items-start gap-3">
        <div className="mt-0.5">
          {item.completed ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
          ) : (
            <Circle className="w-4 h-4 text-muted-foreground/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">{item.text}</p>
          <div className="flex items-center gap-3 mt-1">
            {item.assignee && (
              <span className="text-xs text-violet-600 dark:text-violet-400">@{item.assignee}</span>
            )}
            {item.due_date && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" /> {item.due_date}
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
