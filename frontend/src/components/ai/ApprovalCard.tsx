import { ShieldAlert, Check, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface ApprovalCardProps {
  action: string;
  details: Record<string, unknown>;
  onApprove: () => void;
  onReject: () => void;
}

export function ApprovalCard({ action, details, onApprove, onReject }: ApprovalCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="ml-11 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 dark:border-amber-500/25 dark:bg-amber-950/30"
    >
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400" />
        <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">Approval Required</span>
      </div>
      <p className="text-xs text-foreground/80 mb-3">
        The AI wants to execute: <span className="font-medium">{action.replace(/_/g, " ")}</span>
      </p>
      <pre className="text-[11px] text-muted-foreground bg-muted/60 rounded-lg p-2.5 mb-3 overflow-auto max-h-24 border border-border/50">
        {JSON.stringify(details, null, 2)}
      </pre>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onApprove}
          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs rounded-lg h-8 px-3"
        >
          <Check className="w-3 h-3 mr-1.5" /> Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReject}
          className="text-xs rounded-lg h-8 px-3 border-border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
        >
          <XCircle className="w-3 h-3 mr-1.5" /> Reject
        </Button>
      </div>
    </motion.div>
  );
}
