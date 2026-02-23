/**
 * EmptyState — shown when there are no messages in the AI panel.
 * Displays a welcome message and tab-aware prompt suggestions.
 */
import { Bot } from "lucide-react";
import { PromptSuggestion } from "@/components/prompt-kit/prompt-suggestion";

interface EmptyStateProps {
    suggestions: string[];
    onSend: (message: string) => void;
}

export function EmptyState({ suggestions, onSend }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20">
                <Bot className="w-7 h-7 text-primary" />
            </div>
            <div>
                <p className="text-sm font-medium text-foreground mb-1">How can I help?</p>
                <p className="text-xs text-muted-foreground max-w-[260px]">
                    Ask about Slack, GitHub, meetings, or upload documents for AI analysis.
                </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-[320px] mt-2">
                {suggestions.map((s) => (
                    <PromptSuggestion
                        key={s}
                        onClick={() => onSend(s)}
                        className="border-border text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5"
                    >
                        {s}
                    </PromptSuggestion>
                ))}
            </div>
        </div>
    );
}
