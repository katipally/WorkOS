/**
 * StreamingBlock — renders the unified streaming response block:
 * thinking shimmer, reasoning trace, plan steps, tool calls, content, receipts.
 */
import { PlanCard, type PlanStep } from "./PlanCard";
import { ReceiptBadge, type ReceiptData } from "./ReceiptBadge";
import { RichContent } from "./RichContent";
import { Tool, type ToolPart } from "@/components/prompt-kit/tool";
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/prompt-kit/reasoning";
import { TextShimmer } from "@/components/prompt-kit/text-shimmer";
import { Loader } from "@/components/prompt-kit/loader";

interface StreamingBlockProps {
    isStreaming: boolean;
    streamingContent: string;
    thoughts: string[];
    planSteps: PlanStep[];
    streamingToolParts: ToolPart[];
    receipts: ReceiptData[];
}

export function StreamingBlock({
    isStreaming,
    streamingContent,
    thoughts,
    planSteps,
    streamingToolParts,
    receipts,
}: StreamingBlockProps) {
    if (!isStreaming) return null;

    return (
        <div className="space-y-3">
            {/* Thinking shimmer — shown before any content arrives */}
            {!streamingContent && thoughts.length === 0 && streamingToolParts.length === 0 && (
                <div className="py-1">
                    <TextShimmer as="p" className="text-sm" duration={2} spread={15}>
                        Thinking...
                    </TextShimmer>
                </div>
            )}

            {/* Reasoning trace */}
            {thoughts.length > 0 && (
                <Reasoning isStreaming={isStreaming}>
                    <ReasoningTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground">
                        {!streamingContent ? (
                            <TextShimmer as="span" className="text-xs font-medium" duration={2} spread={10}>
                                Reasoning ({thoughts.length} {thoughts.length === 1 ? "step" : "steps"})
                            </TextShimmer>
                        ) : (
                            <span>Reasoned ({thoughts.length} {thoughts.length === 1 ? "step" : "steps"})</span>
                        )}
                    </ReasoningTrigger>
                    <ReasoningContent className="mt-1.5" contentClassName="text-xs leading-relaxed">
                        <ul className="space-y-1.5 list-none p-0 m-0">
                            {thoughts.map((t, i) => (
                                <li key={i} className="flex items-start gap-2">
                                    <span className="text-primary/60 shrink-0 mt-0.5">›</span>
                                    {i === thoughts.length - 1 && !streamingContent ? (
                                        <TextShimmer as="span" className="text-xs" duration={2} spread={12}>
                                            {t}
                                        </TextShimmer>
                                    ) : (
                                        <span className="text-muted-foreground">{t}</span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </ReasoningContent>
                </Reasoning>
            )}

            {/* Plan steps */}
            {planSteps.length > 0 && <PlanCard steps={planSteps} />}

            {/* Tool calls with status */}
            {streamingToolParts.length > 0 && (
                <div className="space-y-1.5">
                    {streamingToolParts.map((tp, i) => (
                        <Tool key={tp.toolCallId || i} toolPart={tp} className="border-border" />
                    ))}
                </div>
            )}

            {/* Streaming response text */}
            {streamingContent && (
                <div className="text-sm text-foreground">
                    <RichContent content={streamingContent} messageId="streaming" />
                    <span className="inline-flex ml-1 align-middle">
                        <Loader variant="typing" size="sm" />
                    </span>
                </div>
            )}

            {/* Receipts */}
            {receipts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {receipts.map((r, i) => (
                        <ReceiptBadge key={`receipt-${i}`} receipt={r} />
                    ))}
                </div>
            )}
        </div>
    );
}
