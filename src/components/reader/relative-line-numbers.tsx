'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface LineEntry {
  num: string
  isCurrent: boolean
  /** Y position relative to scroll container content top */
  y: number
}

interface RelativeLineNumbersProps {
  /** The scroll container to sync with */
  scrollContainerRef: React.RefObject<HTMLElement | null>
  /** Whether to show line numbers */
  enabled: boolean
  /** Current cursor line (0-indexed) */
  cursorLine: number
  /** Total number of visual lines */
  totalLines: number
  /** Actual Y positions of each visual line (from computeVisualLines) */
  linePositions: number[]
}

const LINE_NUM_HEIGHT = 20 // height of each line number element

/**
 * Renders relative line numbers in a left gutter, Vim-style.
 * Uses actual Y positions from the text viewer so line numbers align
 * with real text lines (accounting for paragraph gaps, headers, etc.).
 *
 * The "current line" shows its absolute number (1-indexed).
 * Lines above/below show relative distance (1, 2, 3...).
 */
export function RelativeLineNumbers({
  scrollContainerRef,
  enabled,
  cursorLine,
  totalLines,
  linePositions,
}: RelativeLineNumbersProps) {
  const [visibleLines, setVisibleLines] = useState<LineEntry[]>([])
  const [scrollTop, setScrollTop] = useState(0)
  const gutterRef = useRef<HTMLDivElement>(null)

  const computeVisible = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !enabled || linePositions.length === 0) {
      setVisibleLines([])
      return
    }

    const st = container.scrollTop
    setScrollTop(st)
    const viewportHeight = container.clientHeight
    const padding = 50 // extra px above/below to render

    const viewStart = st - padding
    const viewEnd = st + viewportHeight + padding

    const entries: LineEntry[] = []
    for (let i = 0; i < linePositions.length; i++) {
      const y = linePositions[i]
      // Only render lines within the visible range (+ padding)
      if (y < viewStart - LINE_NUM_HEIGHT || y > viewEnd) continue

      const distance = i - cursorLine
      const isCurrent = distance === 0
      const num = isCurrent
        ? String(i + 1) // Absolute line number (1-indexed)
        : String(Math.abs(distance)) // Relative distance

      entries.push({ num, isCurrent, y })
    }

    setVisibleLines(entries)
  }, [scrollContainerRef, enabled, cursorLine, linePositions])

  // Compute on mount, scroll, and cursor/position change
  useEffect(() => {
    if (!enabled) return
    const container = scrollContainerRef.current
    if (!container) return

    computeVisible()

    const onScroll = () => requestAnimationFrame(computeVisible)
    container.addEventListener('scroll', onScroll, { passive: true })

    const resizeObserver = new ResizeObserver(computeVisible)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [enabled, computeVisible, scrollContainerRef])

  // Recompute when cursor or positions change
  useEffect(() => {
    if (enabled) computeVisible()
  }, [cursorLine, linePositions, enabled, computeVisible])

  if (!enabled) return null

  return (
    <div
      ref={gutterRef}
      className="
        relative shrink-0 w-10
        bg-zinc-950/50 border-r border-zinc-800/50
        overflow-hidden select-none
        font-mono text-[10px]
      "
      aria-hidden="true"
    >
      {visibleLines.map((line, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: line.y - scrollTop,
            left: 0,
            right: 0,
            height: LINE_NUM_HEIGHT,
          }}
          className={`
            flex items-center justify-end pr-2
            ${line.isCurrent
              ? 'text-amber-400 font-bold'
              : 'text-zinc-600'
            }
          `}
        >
          {line.num}
        </div>
      ))}
    </div>
  )
}
