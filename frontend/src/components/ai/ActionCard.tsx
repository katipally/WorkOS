import { memo } from "react";
import { motion } from "framer-motion";
import {
  Calendar, ExternalLink, AlertTriangle, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface ActionCardData {
  type: "confirm" | "link" | "calendar" | "info";
  title: string;
  description?: string;
  actions?: ActionCardAction[];
  metadata?: Record<string, unknown>;
}

export interface ActionCardAction {
  label: string;
  variant?: "default" | "outline" | "destructive";
  url?: string;
  onClick?: () => void;
}

interface ActionCardProps {
  data: ActionCardData;
  onAction?: (actionLabel: string) => void;
}

const typeConfig = {
  confirm: {
    icon: AlertTriangle,
    color: "border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/30",
    iconColor: "text-amber-500 dark:text-amber-400",
  },
  link: {
    icon: ExternalLink,
    color: "border-blue-500/30 bg-blue-500/5 dark:bg-blue-950/30",
    iconColor: "text-blue-500 dark:text-blue-400",
  },
  calendar: {
    icon: Calendar,
    color: "border-violet-500/30 bg-violet-500/5 dark:bg-violet-950/30",
    iconColor: "text-violet-500 dark:text-violet-400",
  },
  info: {
    icon: Zap,
    color: "border-border bg-muted/30",
    iconColor: "text-primary",
  },
};

export const ActionCard = memo(function ActionCard({ data, onAction }: ActionCardProps) {
  const cfg = typeConfig[data.type] || typeConfig.info;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("ml-11 p-4 rounded-xl border", cfg.color)}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", cfg.iconColor)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium text-foreground">{data.title}</span>
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">
              {data.type}
            </Badge>
          </div>
          {data.description && (
            <p className="text-xs text-muted-foreground mb-3">{data.description}</p>
          )}

          {/* Metadata */}
          {data.metadata && Object.keys(data.metadata).length > 0 && (
            <div className="bg-muted/40 rounded-lg p-2 mb-3">
              {Object.entries(data.metadata).map(([key, value]) => (
                <div key={key} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="text-foreground font-medium">{String(value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          {data.actions && data.actions.length > 0 && (
            <div className="flex items-center gap-2">
              {data.actions.map((action) =>
                action.url ? (
                  <a
                    key={action.label}
                    href={action.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant={action.variant || "default"} className="text-xs h-7 px-3 gap-1">
                      <ExternalLink className="w-3 h-3" />
                      {action.label}
                    </Button>
                  </a>
                ) : (
                  <Button
                    key={action.label}
                    size="sm"
                    variant={action.variant || "default"}
                    className="text-xs h-7 px-3"
                    onClick={() => {
                      action.onClick?.();
                      onAction?.(action.label);
                    }}
                  >
                    {action.label}
                  </Button>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
});
