'use client'

import { type ReactNode } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface BlockTooltipProps {
  children: ReactNode
  /** Primary label (e.g. button name) */
  label: string
  /** Keyboard shortcut display string */
  shortcut?: string
  /** Which side to show tooltip */
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Additional hint text */
  hint?: string
}

/**
 * Glassy block-style tooltip — the WordByWord signature look.
 * Shows the action label and its keyboard shortcut in a frosted-glass pill.
 */
export function BlockTooltip({ children, label, shortcut, side = 'top', hint }: BlockTooltipProps) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        sideOffset={6}
        className="
          bg-background/80 backdrop-blur-xl
          border border-border/50
          rounded-lg shadow-lg shadow-black/10
          px-3 py-2
          animate-in fade-in-0 zoom-in-95
          data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95
        "
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          {shortcut && (
            <kbd className="
              inline-flex items-center
              bg-muted/60 backdrop-blur-sm
              border border-border/40
              rounded-md px-1.5 py-0.5
              text-[10px] font-mono font-semibold
              text-muted-foreground
              shadow-sm
            ">
              {shortcut}
            </kbd>
          )}
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground/70 mt-1">{hint}</p>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Element type indicator badge ────────────────────────────────────────────

interface NibElementBadgeProps {
  /** Type label: "paragraph", "header", "section", "footnote", "sentence" */
  type: string
  /** Whether the indicator is visible */
  visible?: boolean
}

/**
 * Small glassy badge that labels a .nib element type.
 * Shown above paragraphs, headers, etc. when the indicator toggle is on.
 */
export function NibElementBadge({ type, visible = true }: NibElementBadgeProps) {
  if (!visible) return null

  const colorMap: Record<string, string> = {
    header: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    paragraph: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    introduction: 'bg-teal-500/15 text-teal-600 border-teal-500/30',
    blockquote: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30',
    'list-item': 'bg-orange-500/15 text-orange-600 border-orange-500/30',
    'figure-caption': 'bg-pink-500/15 text-pink-600 border-pink-500/30',
    figure: 'bg-pink-500/15 text-pink-600 border-pink-500/30',
    epigraph: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
    sentence: 'bg-green-500/15 text-green-600 border-green-500/30',
    footnote: 'bg-purple-500/15 text-purple-600 border-purple-500/30',
    footer: 'bg-gray-500/15 text-gray-600 border-gray-500/30',
    section: 'bg-red-500/15 text-red-600 border-red-500/30',
    word: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  }

  const colors = colorMap[type.toLowerCase()] || 'bg-muted/50 text-muted-foreground border-border/50'

  return (
    <span className={`
      inline-flex items-center
      ${colors}
      backdrop-blur-sm
      border rounded-md
      px-1.5 py-0.5
      text-[9px] font-mono font-bold uppercase tracking-wider
      select-none pointer-events-none
    `}>
      {type}
    </span>
  )
}
