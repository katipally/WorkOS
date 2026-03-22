"use client"

import type { FC } from "react"
import { cn } from "@/lib/utils"

interface WorkOSSparkleProps {
  className?: string
}

export const WorkOSSparkle: FC<WorkOSSparkleProps> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    className={cn("size-5", className)}
    aria-hidden
  >
    <defs>
      <linearGradient id="sparkle-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4285f4" />
        <stop offset="50%" stopColor="#9b72cb" />
        <stop offset="100%" stopColor="#d96570" />
      </linearGradient>
    </defs>
    <path
      d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
      fill="url(#sparkle-gradient)"
    />
  </svg>
)

export const WorkOSSparkleSmall: FC<WorkOSSparkleProps> = ({ className }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    className={cn("size-4", className)}
    aria-hidden
  >
    <defs>
      <linearGradient id="sparkle-sm-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4285f4" />
        <stop offset="50%" stopColor="#9b72cb" />
        <stop offset="100%" stopColor="#d96570" />
      </linearGradient>
    </defs>
    <path
      d="M8 1L9.6 6.4L15 8L9.6 9.6L8 15L6.4 9.6L1 8L6.4 6.4L8 1Z"
      fill="url(#sparkle-sm-gradient)"
    />
  </svg>
)
