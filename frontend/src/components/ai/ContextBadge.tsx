import { Badge } from "@/components/ui/badge";
import { Hash, Github, Video, Settings } from "lucide-react";
import type { Tab } from "@/types";

const TAB_CONFIG: Record<string, { icon: React.ReactNode; label: string; classes: string }> = {
  slack: {
    icon: <Hash className="w-3 h-3" />,
    label: "Slack",
    classes: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25",
  },
  github: {
    icon: <Github className="w-3 h-3" />,
    label: "GitHub",
    classes: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25",
  },
  meetings: {
    icon: <Video className="w-3 h-3" />,
    label: "Meetings",
    classes: "bg-violet-500/10 text-violet-600 border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/25",
  },
  settings: {
    icon: <Settings className="w-3 h-3" />,
    label: "Settings",
    classes: "bg-muted text-muted-foreground border-border",
  },
};

export function ContextBadge({ tab }: { tab: Tab }) {
  const config = TAB_CONFIG[tab] || TAB_CONFIG.slack;
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 gap-1 font-medium ${config.classes}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
