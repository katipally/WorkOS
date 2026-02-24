import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Video, Plus, Upload, Loader2, FileText,
  Calendar, ChevronRight, Trash2, AlertCircle, CheckCircle2,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { meetingsApi } from "@/api/client";
import { useAppStore } from "@/store/useAppStore";
import type { Meeting } from "@/types";
import { MeetingDetail } from "./MeetingDetail";

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Upload className="w-3 h-3" />, label: "Pending", color: "text-muted-foreground bg-muted" },
  processing: { icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Processing", color: "text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15" },
  ready: { icon: <CheckCircle2 className="w-3 h-3" />, label: "Ready", color: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-500/15" },
  error: { icon: <AlertCircle className="w-3 h-3" />, label: "Error", color: "text-destructive bg-destructive/10" },
};

export function MeetingsView() {
  const queryClient = useQueryClient();
  const { selectedMeetingId, setSelectedMeetingId } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "processing" | "ready" | "error">("all");

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["meetings"],
    queryFn: meetingsApi.list,
    refetchInterval: 10000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { title: string }) => meetingsApi.create(data),
    onSuccess: (meeting) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setSelectedMeetingId(meeting.id);
      setCreateOpen(false);
      setNewTitle("");
      toast.success("Meeting created");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => meetingsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setSelectedMeetingId(null);
      toast.success("Meeting deleted");
    },
  });

  const selectedMeeting = meetings.find((m) => m.id === selectedMeetingId);
  const counts = useMemo(() => ({
    pending: meetings.filter((m) => m.status === "pending").length,
    processing: meetings.filter((m) => m.status === "processing").length,
    ready: meetings.filter((m) => m.status === "ready").length,
    error: meetings.filter((m) => m.status === "error").length,
  }), [meetings]);

  const visibleMeetings = useMemo(() => {
    return [...meetings]
      .filter((meeting) => {
        if (statusFilter !== "all" && meeting.status !== statusFilter) return false;
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          meeting.title.toLowerCase().includes(q)
          || (meeting.summary || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [meetings, search, statusFilter]);

  if (selectedMeeting) {
    return (
      <MeetingDetail
        meeting={selectedMeeting}
        onBack={() => setSelectedMeetingId(null)}
        onDelete={() => deleteMutation.mutate(selectedMeeting.id)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Video className="w-5 h-5 text-violet-500 dark:text-violet-400" />
          <h1 className="text-lg font-semibold text-foreground">Meetings</h1>
          <Badge variant="secondary" className="text-xs">{meetings.length}</Badge>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="text-xs">
              <Plus className="w-4 h-4 mr-1" /> New Meeting
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Meeting</DialogTitle>
            </DialogHeader>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Meeting title..."
              className="bg-muted border-border"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTitle.trim()) {
                  createMutation.mutate({ title: newTitle.trim() });
                }
              }}
            />
            <DialogFooter>
              <Button
                onClick={() => createMutation.mutate({ title: newTitle.trim() || "Untitled Meeting" })}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Meeting List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-2">
          {!isLoading && meetings.length > 0 && (
            <div className="space-y-2 pb-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <StatusStat label="Ready" value={counts.ready} tone="ready" />
                <StatusStat label="Processing" value={counts.processing} tone="processing" />
                <StatusStat label="Pending" value={counts.pending} tone="pending" />
                <StatusStat label="Errors" value={counts.error} tone="error" />
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search meetings, summaries..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["all", "pending", "processing", "ready", "error"] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`text-[10px] px-2 py-0.5 rounded-full capitalize transition-colors ${
                      statusFilter === status
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {status}
                  </button>
                ))}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {visibleMeetings.length} result{visibleMeetings.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!isLoading && meetings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Video className="w-12 h-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm text-muted-foreground mb-1">No meetings yet</p>
              <p className="text-xs text-muted-foreground/70 mb-4">
                Create a meeting and upload transcripts, audio or video recordings.
              </p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Create First Meeting
              </Button>
            </div>
          )}

          {!isLoading && meetings.length > 0 && visibleMeetings.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground mb-1">No meetings match your filters</p>
              <p className="text-xs text-muted-foreground/70">Try another keyword or status.</p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            {visibleMeetings.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onClick={() => setSelectedMeetingId(meeting.id)}
                onDelete={() => deleteMutation.mutate(meeting.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
    </div>
  );
}

function StatusStat({ label, value, tone }: { label: string; value: number; tone: "ready" | "processing" | "pending" | "error" }) {
  const toneClass = {
    ready: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    processing: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    pending: "bg-muted text-muted-foreground border-border",
    error: "bg-destructive/10 text-destructive border-destructive/30",
  }[tone];

  return (
    <div className={`rounded-lg border px-2.5 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-sm font-semibold leading-tight">{value}</p>
    </div>
  );
}

function MeetingCard({
  meeting,
  onClick,
  onDelete,
}: {
  meeting: Meeting;
  onClick: () => void;
  onDelete: () => void;
}) {
  const status = STATUS_CONFIG[meeting.status] || STATUS_CONFIG.pending;
  const fileCount = meeting.files?.length || 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      <Card
        className="bg-card border-border hover:border-border/80 cursor-pointer transition-colors group"
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-sm font-medium text-foreground truncate">{meeting.title}</h3>
                <Badge variant="outline" className={`text-[10px] h-5 gap-1 ${status.color}`}>
                  {status.icon} {status.label}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(meeting.meeting_date).toLocaleDateString()}
                </span>
                {fileCount > 0 && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {fileCount} file{fileCount > 1 ? "s" : ""}
                  </span>
                )}
                {meeting.action_items?.length > 0 && (
                  <span className="text-violet-600 dark:text-violet-400">
                    {meeting.action_items.length} action item{meeting.action_items.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {meeting.summary && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{meeting.summary}</p>
              )}
            </div>
            <div className="flex items-center gap-1 ml-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
