import { memo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThoughtTraceProps {
  thoughts: string[];
  isStreaming?: boolean;
}

export const ThoughtTrace = memo(function ThoughtTrace({ thoughts, isStreaming }: ThoughtTraceProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (thoughts.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-11 rounded-xl border border-border/50 bg-muted/20 overflow-hidden"
    >
      {/* Toggle header */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-accent/20 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2 text-xs">
          <Brain className={cn(
            "w-3.5 h-3.5",
            isStreaming ? "text-primary animate-pulse" : "text-muted-foreground",
          )} />
          <span className="font-medium text-foreground">
            {isStreaming ? "Thinking..." : `Thought process (${thoughts.length} steps)`}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-1.5">
              {thoughts.map((thought, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.15 }}
                  className="flex items-start gap-2 text-xs"
                >
                  <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-medium">
                    {i + 1}
                  </span>
                  <span className={cn(
                    "text-muted-foreground",
                    i === thoughts.length - 1 && isStreaming && "text-foreground",
                  )}>
                    {thought}
                  </span>
                </motion.div>
              ))}
              {isStreaming && (
                <div className="flex items-center gap-2 text-xs text-primary/60 pl-6">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse">●</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
