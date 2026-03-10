'use client'

import { useState, useRef, useCallback, useEffect, type CSSProperties } from 'react'
import { NibElementBadge } from '@/components/ui/block-tooltip'
import type { NibWord } from '@/lib/nib'

interface WordInfoPanelProps {
  word: NibWord
  /** The DOM element of the clicked word span — used to position the panel */
  anchorEl: HTMLElement | null
  showIndicators?: boolean
  onClose: () => void
}

/**
 * Floating word-info panel that:
 *  1. Appears at the top-right of the clicked word
 *  2. Has a grip handle for dragging
 *  3. Pins in place once dragged (no longer follows the anchor)
 */
export function WordInfoPanel({ word, anchorEl, showIndicators, onClose }: WordInfoPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [isPinned, setIsPinned] = useState(false)
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null)
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 })

  // Compute anchor-based position (top-right of the word)
  const getAnchorPos = useCallback((): { x: number; y: number } | null => {
    if (!anchorEl) return null
    const rect = anchorEl.getBoundingClientRect()
    // Position: right edge of word, above the word
    return {
      x: rect.right + 8,
      y: rect.top - 4,
    }
  }, [anchorEl])

  // Current position: pinned overrides anchor
  const getPosition = useCallback((): { x: number; y: number } => {
    if (isPinned && pinnedPos) return pinnedPos
    return getAnchorPos() ?? { x: 200, y: 200 }
  }, [isPinned, pinnedPos, getAnchorPos])

  // Clamp panel to viewport
  const clampToViewport = useCallback((x: number, y: number): { x: number; y: number } => {
    const panel = panelRef.current
    if (!panel) return { x, y }
    const pw = panel.offsetWidth
    const ph = panel.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    return {
      x: Math.max(4, Math.min(x, vw - pw - 4)),
      y: Math.max(4, Math.min(y, vh - ph - 4)),
    }
  }, [])

  // ── Drag handlers ──
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragging.current = true
    const pos = getPosition()
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, panelX: pos.x, panelY: pos.y }

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const dx = ev.clientX - dragStart.current.mouseX
      const dy = ev.clientY - dragStart.current.mouseY
      const newX = dragStart.current.panelX + dx
      const newY = dragStart.current.panelY + dy
      setDragOffset({ x: newX, y: newY })
    }

    const onUp = () => {
      dragging.current = false
      // Pin the panel where it was dropped
      if (dragOffset || true) {
        const dx = 0 // we read from setDragOffset
        setPinnedPos(prev => {
          // Use the last dragOffset value
          return prev
        })
      }
      setIsPinned(true)
      // Transfer drag offset to pinned position
      setPinnedPos((_prev) => dragOffset ?? getPosition())
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [getPosition, dragOffset])

  // When drag offset changes during drag, update pinned pos for smooth handoff
  useEffect(() => {
    if (dragging.current && dragOffset) {
      setPinnedPos(dragOffset)
    }
  }, [dragOffset])

  // Reset pin when word changes
  useEffect(() => {
    setIsPinned(false)
    setPinnedPos(null)
    setDragOffset(null)
  }, [word])

  const pos = isPinned && pinnedPos ? pinnedPos : (dragOffset && dragging.current ? dragOffset : getAnchorPos() ?? { x: 200, y: 200 })
  const clamped = clampToViewport(pos.x, pos.y)

  const style: CSSProperties = {
    position: 'fixed',
    left: clamped.x,
    top: clamped.y,
    zIndex: 50,
    maxWidth: '22rem',
    willChange: dragging.current ? 'transform' : undefined,
  }

  return (
    <div ref={panelRef} style={style} className="select-none">
      <div className="
        bg-background/90 backdrop-blur-xl
        border border-border/50
        rounded-lg shadow-lg shadow-black/10
        overflow-hidden
      ">
        {/* Drag handle bar */}
        <div
          onMouseDown={onDragStart}
          className="
            flex items-center justify-between px-3 py-1.5
            cursor-grab active:cursor-grabbing
            bg-muted/40 border-b border-border/30
            select-none
          "
        >
          {/* Grip dots */}
          <div className="flex gap-0.5 opacity-40">
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
            <span className="w-1 h-1 rounded-full bg-foreground/60" />
          </div>
          {isPinned && (
            <span className="text-[9px] text-muted-foreground/50 font-mono mx-2">pinned</span>
          )}
          <button
            className="text-muted-foreground hover:text-foreground text-xs leading-none p-0.5 -mr-1"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {/* Content */}
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            {showIndicators && <NibElementBadge type="word" />}
            <span className="font-bold text-lg">{word.text}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-1 leading-snug">
            <span className="font-medium">Sentence:</span> {word.sentence.text}
          </p>
          <p className="text-xs text-muted-foreground/70">
            Page {word.page.pageNumber} · Paragraph {word.paragraph.index + 1} · Word {word.index + 1}
          </p>
        </div>
      </div>
    </div>
  )
}
