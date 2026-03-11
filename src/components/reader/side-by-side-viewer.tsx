'use client'

import { useRef, useCallback, useEffect, useState } from 'react'
import { PDFViewer, type HighlightWordInfo, type PDFViewerHandle } from './pdf-viewer'
import { TextViewer } from './text-viewer'
import { NibTextViewer, type NibTextViewerHandle, type CursorLineInfo } from './nib-text-viewer'
import { RelativeLineNumbers } from './relative-line-numbers'
import type { NibDocument, NibWord } from '@/lib/nib'

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
  onPageProgress?: (currentPage: number, totalPages: number, scrollPercent: number) => void
  syncScroll?: boolean
  /** Forward ref for vim-driven word selection */
  nibTextViewerRef?: React.RefObject<NibTextViewerHandle | null>
  /** Book title for vocab context */
  bookTitle?: string
  /** Current vim mode */
  vimMode?: 'normal' | 'sentence' | 'visual'
  /** Original section end page (before overlap extension) for divider */
  sectionEndPage?: number
  /** Whether to show relative line numbers gutter */
  showLineNumbers?: boolean
  /** Called with text-side scroll progress (0-100) so parent can use it for progress bar */
  onTextScrollProgress?: (percent: number) => void
}

export function SideBySideViewer({ pdfBlob, startPage, endPage, text, nibDocument, sectionTitle, readingMode, showIndicators = false, currentPage, onPageChange, onPageProgress, syncScroll = false, nibTextViewerRef, bookTitle, vimMode, sectionEndPage, showLineNumbers = false, onTextScrollProgress }: SideBySideViewerProps) {
  const textRef = useRef<HTMLDivElement>(null)
  const pdfScrollRef = useRef<HTMLDivElement>(null)
  const pdfViewerRef = useRef<PDFViewerHandle>(null)

  // ── Word highlight state ──
  const [highlightWord, setHighlightWord] = useState<HighlightWordInfo | null>(null)

  // ── Relative line numbers state (for vim mode) ──
  const [cursorLine, setCursorLine] = useState(0)
  const [totalVisualLines, setTotalVisualLines] = useState(0)
  const [linePositions, setLinePositions] = useState<number[]>([])

  const handleCursorLineChange = useCallback((info: CursorLineInfo) => {
    setCursorLine(info.cursorLine)
    setTotalVisualLines(info.totalLines)
    setLinePositions(info.linePositions)
  }, [])

  // ── Text-side scroll progress tracking ──
  const handleTextScrollForProgress = useCallback(() => {
    const el = textRef.current
    if (!el || !onTextScrollProgress) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    if (maxScroll <= 0) {
      onTextScrollProgress(100)
      return
    }
    const percent = Math.min(100, Math.round((scrollTop / maxScroll) * 100))
    onTextScrollProgress(percent)
  }, [onTextScrollProgress])

  // Track which PDF page is currently synced to avoid redundant scrolls
  const lastSyncedPageRef = useRef<number>(0)

  /**
   * Content-aware sync: Given a NibWord, scroll the PDF to show its page.
   * This replaces the old scroll-ratio based sync with precise page alignment.
   */
  const syncPdfToWord = useCallback((word: NibWord) => {
    const pageNum = word.page.pageNumber
    if (pageNum === lastSyncedPageRef.current) return
    lastSyncedPageRef.current = pageNum
    pdfViewerRef.current?.scrollToPage(pageNum, 'smooth')
  }, [])

  const handleWordSelect = useCallback((word: NibWord) => {
    // Set highlight info for the PDF overlay, including pdfRect for precise positioning
    setHighlightWord({
      text: word.text,
      pageNumber: word.page.pageNumber,
      sentenceText: word.sentence.text,
      wordIndex: word.index,
      pdfRect: word.pdfRect ?? undefined,
    })
    // Also sync PDF scroll to the word's page
    syncPdfToWord(word)
  }, [syncPdfToWord])

  const handleDeselect = useCallback(() => {
    // Clear PDF highlight and reset synced page so scroll sync resumes
    setHighlightWord(null)
    lastSyncedPageRef.current = 0
  }, [])

  /**
   * Passive content-aware sync: As the user scrolls through text,
   * find which NibPage is currently at the top of the visible area
   * and scroll the PDF to that page.
   *
   * Instead of matching scroll ratios (which is inaccurate because text
   * and PDF have different content heights), we find the actual word
   * elements in the DOM and check which NibDocument page they belong to.
   */
  const handleTextScroll = useCallback(() => {
    if (!syncScroll || !nibDocument) return
    const textEl = textRef.current
    if (!textEl) return

    // Find word spans in the visible viewport area
    // We check word spans near the top of the scroll container to determine
    // which page the user is currently reading
    const containerRect = textEl.getBoundingClientRect()
    // Target: the word span nearest to 1/3 from the top of the viewport
    // (top-third gives a good "currently reading" position)
    const targetY = containerRect.top + containerRect.height * 0.33

    // Query word spans in the text pane
    const wordSpans = textEl.querySelectorAll<HTMLSpanElement>('[data-word-index]')
    let closestSpan: HTMLSpanElement | null = null
    let closestDist = Infinity

    for (const span of wordSpans) {
      const rect = span.getBoundingClientRect()
      // Only consider spans that are within the visible area
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue
      const dist = Math.abs(rect.top - targetY)
      if (dist < closestDist) {
        closestDist = dist
        closestSpan = span
      }
    }

    if (!closestSpan) return
    const wordIndex = parseInt(closestSpan.dataset.wordIndex ?? '0', 10)

    // Find which NibPage this word belongs to
    let cumWords = 0
    for (const page of nibDocument.pages) {
      const pageWordCount = page.allWords.length
      if (wordIndex < cumWords + pageWordCount) {
        const pageNum = page.pageNumber
        if (pageNum !== lastSyncedPageRef.current) {
          lastSyncedPageRef.current = pageNum
          pdfViewerRef.current?.scrollToPage(pageNum, 'smooth')
        }
        return
      }
      cumWords += pageWordCount
    }
  }, [syncScroll, nibDocument])

  // Debounced text scroll handler to avoid thrashing
  const scrollRafRef = useRef<number | null>(null)
  const debouncedTextScroll = useCallback(() => {
    if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = requestAnimationFrame(() => {
      handleTextScroll()
      scrollRafRef.current = null
    })
  }, [handleTextScroll])

  // Clean up raf on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  // Combined scroll handler: debounced content sync + text progress
  const combinedTextScroll = useCallback(() => {
    debouncedTextScroll()
    handleTextScrollForProgress()
  }, [debouncedTextScroll, handleTextScrollForProgress])

  return (
    <div className="grid grid-cols-2 h-full min-h-0">
      <div className="h-full min-h-0 flex">
        <RelativeLineNumbers
          scrollContainerRef={textRef}
          enabled={showLineNumbers}
          cursorLine={cursorLine}
          totalLines={totalVisualLines}
          linePositions={linePositions}
        />
        <div
          ref={textRef}
          className="h-full min-h-0 overflow-auto flex-1"
          onScroll={combinedTextScroll}
        >
          <div className="p-4">
            {nibDocument ? (
              <NibTextViewer
                ref={nibTextViewerRef}
                nibDocument={nibDocument}
                sectionTitle={sectionTitle}
                showIndicators={showIndicators}
                onWordSelect={handleWordSelect}
                onDeselect={handleDeselect}
                scrollContainerRef={textRef}
                bookTitle={bookTitle}
                vimMode={vimMode}
                onCursorLineChange={handleCursorLineChange}
              />
            ) : (
              <TextViewer text={text} sectionTitle={sectionTitle} />
            )}
          </div>
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
          highlightWord={highlightWord}
          pdfViewerRef={pdfViewerRef}
          sectionEndPage={sectionEndPage}
        />
      </div>
    </div>
  )
}
