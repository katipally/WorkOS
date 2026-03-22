"use client"

import { CheckCircle2, Circle, Loader2, ListChecks } from "lucide-react"
import type { TodoItem } from "@/lib/types"
import { cn } from "@/lib/utils"

interface TodoListProps {
  todos: TodoItem[]
}

const StatusIcon = ({ status }: { status: string }) => {
  switch (status) {
    case "done":
      return <CheckCircle2 className="size-3.5 text-chart-2" />
    case "in_progress":
      return <Loader2 className="size-3.5 animate-spin text-primary" />
    default:
      return <Circle className="size-3.5 text-gemini-on-surface-muted/40" />
  }
}

export function TodoList({ todos }: TodoListProps) {
  if (!todos.length) return null

  const done = todos.filter((t) => t.status === "done").length
  const total = todos.length
  const progressPct = Math.round((done / total) * 100)

  return (
    <div className="my-3 rounded-2xl bg-secondary/40 p-4 animate-scale-in">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gemini-on-surface">
          <ListChecks className="size-4 text-primary" />
          Plan
        </div>
        <span className="text-xs text-gemini-on-surface-muted">
          {done}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        {todos.map((todo, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors",
              todo.status === "done" && "text-gemini-on-surface-muted"
            )}
          >
            <StatusIcon status={todo.status} />
            <span className={cn(todo.status === "done" && "line-through")}>{todo.title}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
