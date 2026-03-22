"use client"

import "@assistant-ui/react-markdown/styles/dot.css"
import "katex/dist/katex.min.css"

import {
  type CodeHeaderProps,
  MarkdownTextPrimitive,
  unstable_memoizeMarkdownComponents as memoizeMarkdownComponents,
  useIsMarkdownCodeBlock,
} from "@assistant-ui/react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import { type FC, memo, useState, useEffect, useRef, type HTMLAttributes } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const MarkdownTextImpl = () => {
  return (
    <MarkdownTextPrimitive
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      className="aui-md"
      components={defaultComponents}
      smooth
    />
  )
}

export const MarkdownText = memo(MarkdownTextImpl)

function useCopyToClipboard() {
  const [isCopied, setIsCopied] = useState(false)
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    })
  }
  return { isCopied, copyToClipboard }
}

const CodeHeader: FC<CodeHeaderProps> = ({ language, code }) => {
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const onCopy = () => {
    if (!code || isCopied) return
    copyToClipboard(code)
  }

  return (
    <div className="flex items-center justify-between rounded-t-xl border border-border/30 border-b-0 bg-[color:var(--code-header-bg)] px-4 py-2 text-xs">
      <span className="font-medium text-gemini-on-surface-muted lowercase">
        {language}
      </span>
      <button
        onClick={onCopy}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-gemini-on-surface-muted transition-colors hover:bg-black/5 hover:text-gemini-on-surface dark:hover:bg-white/10"
        title="Copy code"
      >
        {isCopied ? (
          <>
            <CheckIcon className="size-3" />
            <span>Copied</span>
          </>
        ) : (
          <>
            <CopyIcon className="size-3" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  )
}

// Shiki highlighter singleton (lazy-loaded)
let highlighterPromise: Promise<import("shiki").Highlighter> | null = null

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: [
          "python", "javascript", "typescript", "tsx", "jsx", "json", "bash",
          "shell", "html", "css", "sql", "yaml", "toml", "markdown", "rust",
          "go", "java", "c", "cpp", "csharp", "ruby", "php", "swift", "kotlin",
          "xml", "dockerfile", "graphql",
        ],
      })
    )
  }
  return highlighterPromise
}

// Highlighted code block component — streaming-safe with MutationObserver
function HighlightedPre({ children, className, ...props }: HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const pre = preRef.current
    if (!pre) return

    // Track text locally to this effect run (StrictMode-safe)
    let localPrevText = ""

    const doHighlight = () => {
      const codeEl = pre.querySelector("code")
      if (!codeEl) return
      const text = codeEl.textContent || ""
      if (!text.trim() || text === localPrevText) return
      localPrevText = text

      // Show plain pre immediately (reset highlight)
      setHighlightedHtml((prev) => (prev !== null ? null : prev))

      // Debounce Shiki highlighting — wait for content to stabilize
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const langClass = codeEl.className?.match(/language-(\w+)/)?.[1] || ""
        getHighlighter()
          .then((highlighter) => {
            const supportedLangs = highlighter.getLoadedLanguages()
            const lang = supportedLangs.includes(langClass) ? langClass : "text"
            const html = highlighter.codeToHtml(text, {
              lang,
              themes: { light: "github-light", dark: "github-dark" },
              defaultColor: false,
            })
            // Only apply if text hasn't changed since debounce started
            if (localPrevText === text) {
              setHighlightedHtml(html)
            }
          })
          .catch((err) => { console.error("[Shiki] Highlight error:", err) })
      }, 300)
    }

    // Initial highlight
    doHighlight()

    // Watch for streaming content changes
    const observer = new MutationObserver(doHighlight)
    observer.observe(pre, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <div className="mt-3 code-block-wrapper">
      {/* React-managed pre — visible during streaming when not highlighted */}
      <pre
        ref={preRef}
        className={cn(
          "overflow-x-auto rounded-b-xl border border-border/30 border-t-0 bg-[color:var(--code-bg)] p-4 text-[13px] leading-relaxed font-mono",
          highlightedHtml && "!hidden",
          className,
        )}
        {...props}
      >
        {children}
      </pre>
      {/* Shiki highlighted output — shown after content stabilizes */}
      {highlightedHtml && (
        <div
          className="[&>pre]:overflow-x-auto [&>pre]:rounded-b-xl [&>pre]:border [&>pre]:border-border/30 [&>pre]:border-t-0 [&>pre]:p-4 [&>pre]:text-[13px] [&>pre]:leading-relaxed [&>pre]:font-mono [&>pre]:m-0"
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      )}
    </div>
  )
}

const defaultComponents = memoizeMarkdownComponents({
  h1: ({ className, ...props }) => (
    <h1
      className={cn(
        "aui-md-h1 mb-3 scroll-m-20 font-semibold text-base text-gemini-on-surface first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }) => (
    <h2
      className={cn(
        "aui-md-h2 mt-4 mb-2 scroll-m-20 font-semibold text-sm text-gemini-on-surface first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }) => (
    <h3
      className={cn(
        "aui-md-h3 mt-3 mb-1.5 scroll-m-20 font-semibold text-sm text-gemini-on-surface first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }) => (
    <h4
      className={cn(
        "aui-md-h4 mt-2.5 mb-1 scroll-m-20 font-medium text-sm text-gemini-on-surface first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  h5: ({ className, ...props }) => (
    <h5
      className={cn("aui-md-h5 mt-2 mb-1 font-medium text-sm text-gemini-on-surface first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  h6: ({ className, ...props }) => (
    <h6
      className={cn("aui-md-h6 mt-2 mb-1 font-medium text-sm text-gemini-on-surface first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }) => (
    <p
      className={cn("aui-md-p my-2.5 leading-relaxed first:mt-0 last:mb-0", className)}
      {...props}
    />
  ),
  a: ({ className, ...props }) => (
    <a
      className={cn(
        "aui-md-a text-primary underline underline-offset-2 hover:text-primary/80",
        className,
      )}
      {...props}
    />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "aui-md-blockquote my-3 border-primary/30 border-l-2 pl-4 text-gemini-on-surface-muted italic",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }) => (
    <ul
      className={cn(
        "aui-md-ul my-2.5 ml-4 list-disc marker:text-gemini-on-surface-muted [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  ol: ({ className, ...props }) => (
    <ol
      className={cn(
        "aui-md-ol my-2.5 ml-4 list-decimal marker:text-gemini-on-surface-muted [&>li]:mt-1.5",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => (
    <hr className={cn("aui-md-hr my-4 border-border/50", className)} {...props} />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-border/30">
      <table
        className={cn(
          "aui-md-table w-full border-separate border-spacing-0",
          className,
        )}
        {...props}
      />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "aui-md-th bg-secondary/60 px-3 py-2 text-left text-xs font-medium text-gemini-on-surface-muted first:rounded-tl-xl last:rounded-tr-xl",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td
      className={cn(
        "aui-md-td border-border/20 border-b border-l px-3 py-2 text-left last:border-r",
        className,
      )}
      {...props}
    />
  ),
  pre: HighlightedPre,
  code: function Code({ className, ...props }) {
    const isCodeBlock = useIsMarkdownCodeBlock()
    return (
      <code
        className={cn(
          !isCodeBlock &&
            "aui-md-inline-code rounded-md bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.85em] text-primary",
          className,
        )}
        {...props}
      />
    )
  },
  CodeHeader,
})
