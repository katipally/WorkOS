import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type PromptSuggestionProps = {
  children: React.ReactNode
  className?: string
} & React.ButtonHTMLAttributes<HTMLButtonElement>

function PromptSuggestion({
  children,
  className,
  ...props
}: PromptSuggestionProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "h-auto rounded-full px-3 py-1.5 text-xs font-normal whitespace-normal text-left",
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
}

export { PromptSuggestion }
