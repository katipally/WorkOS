import { useState, useCallback } from "react";
import { GitBranch, Pencil, Check, X, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aiApi } from "@/api/client";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatSessionDetail } from "@/types";

interface SessionHeaderProps {
  session: ChatSessionDetail;
  onBranch?: (fromMessageId: string) => void;
}

export function SessionHeader({ session, onBranch: _onBranch }: SessionHeaderProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  const saveTitle = async () => {
    if (title.trim() && title !== session.title) {
      await aiApi.updateSession(session.id, { title: title.trim() });
      qc.invalidateQueries({ queryKey: ["ai-session", session.id] });
      qc.invalidateQueries({ queryKey: ["ai-sessions"] });
    }
    setEditing(false);
  };

  const navigateBranch = useCallback(async (direction: "prev" | "next") => {
    const newBranch = direction === "prev"
      ? Math.max(1, session.branch_id - 1)
      : Math.min(session.max_branch, session.branch_id + 1);
    if (newBranch !== session.branch_id) {
      await aiApi.updateSession(session.id, { branch_id: newBranch });
      qc.invalidateQueries({ queryKey: ["ai-session", session.id] });
      qc.invalidateQueries({ queryKey: ["ai-sessions"] });
    }
  }, [session, qc]);

  return (
    <div className="group flex items-center justify-between px-4 py-1.5 border-b border-border/50 bg-muted/30 shrink-0">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {editing ? (
          <>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") { setTitle(session.title); setEditing(false); }
              }}
              className="h-6 text-xs bg-muted border-border rounded-lg py-0 px-2 flex-1 focus-visible:ring-ring/30"
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 rounded-md" onClick={saveTitle}>
              <Check className="w-3 h-3 text-emerald-500" />
            </Button>
            <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 rounded-md" onClick={() => { setTitle(session.title); setEditing(false); }}>
              <X className="w-3 h-3 text-muted-foreground" />
            </Button>
          </>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground truncate">{session.title}</p>
            <Button
              variant="ghost" size="icon" className="h-5 w-5 shrink-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditing(true)}
            >
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </Button>
          </>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {session.max_branch > 1 && (
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground"
                  disabled={session.branch_id <= 1}
                  onClick={() => navigateBranch("prev")}
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Previous branch</TooltipContent>
            </Tooltip>
            <Badge variant="outline" className="text-[10px] gap-1 h-5 rounded-md border-border text-muted-foreground font-normal">
              <GitBranch className="w-3 h-3" />
              {session.branch_id}/{session.max_branch}
            </Badge>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground"
                  disabled={session.branch_id >= session.max_branch}
                  onClick={() => navigateBranch("next")}
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Next branch</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
