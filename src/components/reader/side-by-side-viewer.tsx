'use client'

import { useRef, useCallback, useEffect } from 'react'
import { PDFViewer } from './pdf-viewer'
import { TextViewer } from './text-viewer'
import { NibTextViewer } from './nib-text-viewer'
import type { NibDocument } from '@/lib/nib'

interface SideBySideViewerProps {
  pdfBlob: Blob
  startPage: number
  endPage: number
  text: string | null
  nibDocument?: NibDocument | null
  sectionTitle: string
  readingMode: 'scroll' | 'flip'
  showIndicators?: boolean
  currentPage?: number
  onPageChange?: (page: number) => void
  highlightRegion?: { top: number; height: number } | null
  onPageProgress?: (currentPage: number, totalPages: number, scrollPercent: number) => void
  syncScroll?: boolean
}

export function SideBySideViewer({ pdfBlob, startPage, endPage, text, nibDocument, sectionTitle, readingMode, showIndicators = false, currentPage, onPageChange, onPageProgress, syncScroll = false }: SideBySideViewerProps) {
  const textRef = useRef<HTMLDivElement>(null)
  const pdfScrollRef = useRef<HTMLDivElement>(null)
  // Guard to prevent scroll event loops
  const isSyncing = useRef(false)

  const getScrollRatio = (el: HTMLElement): number => {
    const max = el.scrollHeight - el.clientHeight
    return max > 0 ? el.scrollTop / max : 0
  }

  const setScrollRatio = (el: HTMLElement, ratio: number) => {
    const max = el.scrollHeight - el.clientHeight
    if (max > 0) {
      el.scrollTop = ratio * max
    }
  }

  const handleTextScroll = useCallback(() => {
    if (!syncScroll || isSyncing.current) return
    const textEl = textRef.current
    const pdfEl = pdfScrollRef.current
    if (!textEl || !pdfEl) return
    isSyncing.current = true
    const ratio = getScrollRatio(textEl)
    setScrollRatio(pdfEl, ratio)
    // Release lock after browser paints
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [syncScroll])

  const handlePdfScroll = useCallback(() => {
    if (!syncScroll || isSyncing.current) return
    const textEl = textRef.current
    const pdfEl = pdfScrollRef.current
    if (!textEl || !pdfEl) return
    isSyncing.current = true
    const ratio = getScrollRatio(pdfEl)
    setScrollRatio(textEl, ratio)
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [syncScroll])

  // Attach/detach PDF scroll listener (since PDFViewer renders canvases into pdfScrollRef)
  useEffect(() => {
    const pdfEl = pdfScrollRef.current
    if (!pdfEl || !syncScroll) return
    pdfEl.addEventListener('scroll', handlePdfScroll, { passive: true })
    return () => pdfEl.removeEventListener('scroll', handlePdfScroll)
  }, [syncScroll, handlePdfScroll])

  return (
    <div className="grid grid-cols-2 h-full min-h-0">
      <div
        ref={textRef}
        className="h-full min-h-0 overflow-auto"
        onScroll={handleTextScroll}
      >
        <div className="p-4">
          {nibDocument ? (
            <NibTextViewer
              nibDocument={nibDocument}
              sectionTitle={sectionTitle}
              showIndicators={showIndicators}
            />
          ) : (
            <TextViewer text={text} sectionTitle={sectionTitle} />
          )}
        </div>
      </div>
      <div className="h-full min-h-0 border-l">
        <PDFViewer
          pdfBlob={pdfBlob}
          startPage={startPage}
          endPage={endPage}
          readingMode={readingMode}
          currentPage={currentPage}
          onPageChange={onPageChange}
          onPageProgress={onPageProgress}
          scrollRef={pdfScrollRef}
        />
      </div>
    </div>
  )
}
