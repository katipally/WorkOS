import { cn } from "@/lib/utils"

export interface LoaderProps {
  variant?: "circular" | "typing" | "dots" | "text-shimmer" | "loading-dots"
  size?: "sm" | "md" | "lg"
  text?: string
  className?: string
}

function TypingLoader({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dotSizes = { sm: "h-1 w-1", md: "h-1.5 w-1.5", lg: "h-2 w-2" }
  return (
    <div className={cn("flex items-center space-x-1", className)}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn("bg-primary rounded-full animate-bounce", dotSizes[size])}
          style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.6s" }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  )
}

function DotsLoader({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const dotSizes = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-2.5 w-2.5" }
  return (
    <div className={cn("flex items-center space-x-1", className)}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn("bg-primary rounded-full animate-pulse", dotSizes[size])}
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  )
}

function CircularLoader({ className, size = "md" }: { className?: string; size?: "sm" | "md" | "lg" }) {
  const sizeClasses = { sm: "size-4", md: "size-5", lg: "size-6" }
  return (
    <div className={cn("border-primary animate-spin rounded-full border-2 border-t-transparent", sizeClasses[size], className)}>
      <span className="sr-only">Loading</span>
    </div>
  )
}

function TextShimmerLoader({ text = "Thinking", className, size = "md" }: { text?: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const textSizes = { sm: "text-xs", md: "text-sm", lg: "text-base" }
  return (
    <div
      className={cn(
        "bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_auto] bg-clip-text font-medium text-transparent animate-[shimmer_3s_infinite_linear]",
        textSizes[size],
        className
      )}
    >
      {text}
    </div>
  )
}

function TextDotsLoader({ className, text = "Thinking", size = "md" }: { className?: string; text?: string; size?: "sm" | "md" | "lg" }) {
  const textSizes = { sm: "text-xs", md: "text-sm", lg: "text-base" }
  return (
    <div className={cn("inline-flex items-center", className)}>
      <span className={cn("text-muted-foreground font-medium", textSizes[size])}>{text}</span>
      <span className="inline-flex">
        {[0.2, 0.4, 0.6].map((d) => (
          <span key={d} className="text-muted-foreground animate-pulse" style={{ animationDelay: `${d}s` }}>.</span>
        ))}
      </span>
    </div>
  )
}

function Loader({ variant = "circular", size = "md", text, className }: LoaderProps) {
  switch (variant) {
    case "circular": return <CircularLoader size={size} className={className} />
    case "typing": return <TypingLoader size={size} className={className} />
    case "dots": return <DotsLoader size={size} className={className} />
    case "text-shimmer": return <TextShimmerLoader text={text} size={size} className={className} />
    case "loading-dots": return <TextDotsLoader text={text} size={size} className={className} />
    default: return <CircularLoader size={size} className={className} />
  }
}

export { Loader }
