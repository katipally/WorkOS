import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Trash2, MessageSquare, Calendar, LayoutGrid,
  List, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { aiApi } from "@/api/client";
import { useAppStore } from "@/store/useAppStore";
import type { ChatSession } from "@/types";
import { cn } from "@/lib/utils";

interface ChatGridProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (session: ChatSession) => void;
}

export function ChatGrid({ open, onClose, onSelectSession }: ChatGridProps) {
  const queryClient = useQueryClient();
  const { currentChatSessionId } = useAppStore();
  const { setCurrentChatSessionId } = useAppStore();
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const { data: sessions = [] } = useQuery({
    queryKey: ["ai-sessions"],
    queryFn: aiApi.listSessions,
    enabled: open,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => aiApi.deleteSession(id),
    onSuccess: (_data, deletedId) => {
      // If the deleted session is the active one, clear it
      if (deletedId === currentChatSessionId) {
        setCurrentChatSessionId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["ai-sessions"] });
    },
  });

  const filtered = useMemo(() => {
    if (!search) return sessions;
    const q = search.toLowerCase();
    return sessions.filter(
      (s) => s.title.toLowerCase().includes(q) || s.focused_tab.toLowerCase().includes(q),
    );
  }, [sessions, search]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, ChatSession[]> = {};
    for (const s of filtered) {
      const d = new Date(s.updated_at);
      const now = new Date();
      let label: string;
      const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays === 0) label = "Today";
      else if (diffDays === 1) label = "Yesterday";
      else if (diffDays < 7) label = "This Week";
      else if (diffDays < 30) label = "This Month";
      else label = "Older";
      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    }
    return groups;
  }, [filtered]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-x-0 top-12 z-50 mx-2 mt-1 rounded-xl border border-border bg-popover/95 backdrop-blur-md shadow-2xl max-h-[calc(100vh-200px)] overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground">Chat History</span>
          <Badge variant="secondary" className="text-[10px] h-4">{sessions.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6 rounded-md", viewMode === "grid" ? "text-primary bg-primary/10" : "text-muted-foreground")}
            onClick={() => setViewMode("grid")}
          >
            <LayoutGrid className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-6 w-6 rounded-md", viewMode === "list" ? "text-primary bg-primary/10" : "text-muted-foreground")}
            onClick={() => setViewMode("list")}
          >
            <List className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md text-muted-foreground" onClick={onClose}>
            <X className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs pl-8 bg-muted/50 border-border"
          />
        </div>
      </div>

      {/* Sessions */}
      <ScrollArea className="flex-1 min-h-0 px-3 pb-3">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            {search ? "No matching conversations" : "No conversations yet"}
          </p>
        )}

        {viewMode === "grid" ? (
          <div className="space-y-4">
            {Object.entries(grouped).map(([label, groupSessions]) => (
              <div key={label}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
                  {label}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {groupSessions.map((s) => (
                    <motion.button
                      key={s.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onSelectSession(s)}
                      className={cn(
                        "text-left p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors group relative",
                        s.id === currentChatSessionId && "border-primary/50 bg-primary/5",
                      )}
                    >
                      <p className="text-xs font-medium text-foreground truncate pr-4">{s.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className="text-[9px] h-4 px-1 border-border">
                          {s.focused_tab}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-2.5 h-2.5" />
                          {new Date(s.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1.5 right-1.5 h-5 w-5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(s.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </motion.button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {Object.entries(grouped).map(([label, groupSessions]) => (
              <div key={label}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5">
                  {label}
                </p>
                <div className="space-y-0.5">
                  {groupSessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onSelectSession(s)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-accent text-left group transition-colors",
                        s.id === currentChatSessionId && "bg-accent",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-foreground truncate">{s.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-border">
                            {s.focused_tab}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(s.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(s.id); }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </motion.div>
  );
}
