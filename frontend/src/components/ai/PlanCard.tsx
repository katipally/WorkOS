import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2, Circle, Loader2, XCircle,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Steps, StepsTrigger, StepsContent, StepsItem,
} from "@/components/prompt-kit/steps";

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
    color: "text-muted-foreground",
    bg: "bg-muted/50",
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
    bg: "bg-emerald-500/10",
    label: "Done",
  },
  failed: {
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Failed",
  },
};

export const PlanCard = memo(function PlanCard({ steps }: PlanCardProps) {
  if (steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === "done").length;
  const allDone = doneCount === steps.length;
  const hasRunning = steps.some((s) => s.status === "running");

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-11 rounded-xl border border-border/60 bg-card/50 overflow-hidden px-3 py-2"
    >
      <Steps defaultOpen={true}>
        <StepsTrigger
          leftIcon={
            <ListChecks className={cn("w-4 h-4", allDone ? "text-emerald-500" : "text-primary")} />
          }
          className="text-xs font-medium"
        >
          {allDone
            ? `Plan completed (${doneCount}/${steps.length})`
            : hasRunning
              ? `Executing plan... (${doneCount}/${steps.length})`
              : `Planned steps (${steps.length})`}
        </StepsTrigger>
        <StepsContent>
          <AnimatePresence>
            {steps.map((step) => {
              const cfg = statusConfig[step.status];
              const Icon = cfg.icon;
              return (
                <StepsItem key={step.id}>
                  <motion.div
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs transition-colors",
                      cfg.bg,
                    )}
                  >
                    <Icon className={cn("w-3.5 h-3.5 shrink-0", cfg.color, "animate" in cfg && cfg.animate && "animate-spin")} />
                    <span className={cn(
                      "flex-1",
                      step.status === "done" ? "text-muted-foreground line-through" : "text-foreground",
                    )}>
                      {step.label}
                    </span>
                    {step.tool && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {step.tool}
                      </span>
                    )}
                  </motion.div>
                </StepsItem>
              );
            })}
          </AnimatePresence>
        </StepsContent>
      </Steps>
    </motion.div>
  );
});
