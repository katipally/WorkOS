import { memo } from "react";
import { motion } from "framer-motion";
import { Receipt, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReceiptData {
  tool: string;
  action: string;
  summary: string;
  success: boolean;
  link?: string;
}

interface ReceiptBadgeProps {
  receipt: ReceiptData;
}

export const ReceiptBadge = memo(function ReceiptBadge({ receipt }: ReceiptBadgeProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs",
        receipt.success
          ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/30"
          : "border-destructive/30 bg-destructive/5 dark:bg-red-950/30",
      )}
    >
      <div className="flex items-center gap-1.5">
        {receipt.success ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
        )}
        <Receipt className="w-3 h-3 text-muted-foreground shrink-0" />
      </div>
      <span className={cn(
        "font-medium",
        receipt.success ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
      )}>
        {receipt.action}
      </span>
      <span className="text-muted-foreground truncate max-w-[200px]">
        {receipt.summary}
      </span>
      {receipt.link && (
        <a
          href={receipt.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </motion.div>
  );
});
