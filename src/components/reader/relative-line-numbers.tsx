'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface RelativeLineNumbersProps {
  /** The scroll container to attach line numbers to */
  scrollContainerRef: React.RefObject<HTMLElement | null>
  /** Whether to show line numbers */
  enabled: boolean
  /** Line height in pixels (default 24) */
  lineHeight?: number
}

/**
 * Renders relative line numbers in a left gutter, Vim-style.
 * The "current line" (center of viewport) shows its absolute number.
 * Lines above/below show relative distance (1, 2, 3...).
 * This helps users do things like "5j" to jump 5 lines down.
 */
export function RelativeLineNumbers({
  scrollContainerRef,
  enabled,
  lineHeight = 24,
}: RelativeLineNumbersProps) {
  const [lines, setLines] = useState<{ num: string; isCurrent: boolean }[]>([])
  const [topOffset, setTopOffset] = useState(0)
  const gutterRef = useRef<HTMLDivElement>(null)

  const computeLines = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container || !enabled) return

    const viewportHeight = container.clientHeight
    const scrollTop = container.scrollTop
    const scrollHeight = container.scrollHeight

    // Total "lines" in the document
    const totalLines = Math.ceil(scrollHeight / lineHeight)

    // Number of visible lines in the viewport
    const visibleLines = Math.ceil(viewportHeight / lineHeight)

    // Current "center" line (what the user is reading)
    const currentLine = Math.floor((scrollTop + viewportHeight / 2) / lineHeight)

    // First visible line
    const firstVisibleLine = Math.floor(scrollTop / lineHeight)

    // We render a few extra lines above/below for smooth scrolling
    const padding = 3
    const startLine = Math.max(0, firstVisibleLine - padding)
    const endLine = Math.min(totalLines - 1, firstVisibleLine + visibleLines + padding)

    const newLines: { num: string; isCurrent: boolean }[] = []
    for (let i = startLine; i <= endLine; i++) {
      const distance = i - currentLine
      const isCurrent = distance === 0
      const num = isCurrent
        ? String(i + 1) // Absolute line number for current line
        : String(Math.abs(distance)) // Relative distance for others
      newLines.push({ num, isCurrent })
    }

    setLines(newLines)
    // Offset the gutter to align with the scroll position
    setTopOffset(startLine * lineHeight - scrollTop)
  }, [scrollContainerRef, enabled, lineHeight])

  // Compute on mount and scroll
  useEffect(() => {
    if (!enabled) return
    const container = scrollContainerRef.current
    if (!container) return

    computeLines()

    const onScroll = () => requestAnimationFrame(computeLines)
    container.addEventListener('scroll', onScroll, { passive: true })

    // Also recompute on resize
    const resizeObserver = new ResizeObserver(computeLines)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
    }
  }, [enabled, computeLines, scrollContainerRef])

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
      <div
        style={{
          position: 'absolute',
          top: topOffset,
          left: 0,
          right: 0,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{ height: lineHeight }}
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
    </div>
  )
}
