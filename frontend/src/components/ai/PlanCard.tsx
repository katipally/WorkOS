import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Circle, Loader2, XCircle,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface PlanStep {
  id: number;
  label: string;
  tool?: string;
  status: "pending" | "running" | "done" | "failed";
}

interface PlanCardProps {
  steps: PlanStep[];
  collapsed?: boolean;
}

const statusConfig = {
  pending: {
    icon: Circle,
    color: "text-muted-foreground/50",
    bg: "bg-transparent",
    label: "Pending",
  },
  running: {
    icon: Loader2,
    color: "text-blue-500 dark:text-blue-400",
    bg: "bg-blue-500/10",
    label: "Running",
    animate: true,
  },
  done: {
    icon: CheckCircle2,
    color: "text-emerald-500 dark:text-emerald-400",
    bg: "bg-emerald-500/5",
    label: "Done",
  },
  failed: {
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/5",
    label: "Failed",
  },
};

export const PlanCard = memo(function PlanCard({ steps }: PlanCardProps) {
  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = doneCount === steps.length;
  const hasRunning = steps.some((s) => s.status === "running");
  const progress = steps.length > 0 ? (doneCount / steps.length) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="rounded-xl border border-border/50 bg-card/40 overflow-hidden"
    >
      {/* Progress bar */}
      <div className="h-0.5 bg-muted/30 overflow-hidden">
        <motion.div
          className={cn(
            "h-full rounded-full",
            allDone ? "bg-emerald-500" : "bg-primary"
          )}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <ListChecks className={cn("w-3.5 h-3.5", allDone ? "text-emerald-500" : "text-primary")} />
        <span className="text-xs font-medium text-foreground/80">
          {allDone
            ? `Plan completed (${doneCount}/${steps.length})`
            : hasRunning
              ? `Executing step ${doneCount + 1} of ${steps.length}`
              : `Planning ${steps.length} steps`}
        </span>
        {hasRunning && (
          <motion.span
            className="ml-auto"
            animate={{ opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />
          </motion.span>
        )}
      </div>

      {/* Steps */}
      <div className="px-2 pb-2 space-y-0.5">
        <AnimatePresence mode="popLayout">
          {steps.map((step, index) => {
            const cfg = statusConfig[step.status];
            const Icon = cfg.icon;
            const isActive = step.status === "running";

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -8, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                transition={{
                  delay: index * 0.08,
                  type: "spring",
                  stiffness: 300,
                  damping: 25,
                }}
                className={cn(
                  "flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-300",
                  cfg.bg,
                  isActive && "ring-1 ring-blue-500/20",
                )}
              >
                <motion.div
                  animate={isActive ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Icon className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    cfg.color,
                    "animate" in cfg && cfg.animate && "animate-spin",
                  )} />
                </motion.div>
                <span className={cn(
                  "flex-1 transition-all duration-300",
                  step.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                )}>
                  {step.label}
                </span>
                {step.tool && (
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    {step.tool}
                  </span>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
});
