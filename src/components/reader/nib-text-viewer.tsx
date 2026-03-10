'use client'

import { useState, useCallback, useRef, useMemo, useEffect, useImperativeHandle, forwardRef } from 'react'
import { NibElementBadge } from '@/components/ui/block-tooltip'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { LatexText, containsLatex } from '@/components/reader/latex-renderer'
import { isTableBlock, TableRenderer } from '@/components/reader/table-renderer'
import { WordInfoPanel } from '@/components/reader/word-info-panel'
import type { NibDocument, NibWord, NibBlockType } from '@/lib/nib'

/** Handle exposed by NibTextViewer for vim-driven selection */
export interface NibTextViewerHandle {
  /** Select a word by delta from current index. delta=0 means "select first visible word" */
  selectWordByDelta: (delta: number) => void
  /** Select a sentence by delta from current sentence */
  selectSentenceByDelta: (delta: number) => void
  /** Select all words on the current visual line */
  selectCurrentLine: () => void
  /** Clear all vim-driven selection */
  clearVimSelection: () => void
  /** Confirm the current selection — show the word info panel */
  confirmSelection: () => void
  /** Move word cursor vertically (to nearest word on line above/below) */
  selectWordVertical: (direction: number) => void
  /** Move sentence cursor vertically to sentence on next/prev line */
  selectSentenceVertical: (direction: number) => void
  /** Move cursor line up/down in normal mode. Returns { cursorLine, totalLines } */
  moveCursorLine: (delta: number) => void
  /** Get current cursor line info */
  getCursorLineInfo: () => { cursorLine: number; totalLines: number }
}

/** Callback for when cursor line changes */
export interface CursorLineInfo {
  cursorLine: number
  totalLines: number
  /** Y position of each visual line relative to scroll container content top */
  linePositions: number[]
}

interface NibTextViewerProps {
  nibDocument: NibDocument | null
  sectionTitle: string
  /** Whether to show element type indicators (paragraph, header, etc.) */
  showIndicators?: boolean
  /** Called when a word is tapped — parent can use word.getAIContext() for translation */
  onWordSelect?: (word: NibWord) => void
  /** Set of word indices currently selected via vim (highlighted) */
  vimSelectedIndices?: Set<number>
  /** The scroll container ref for finding visible words */
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  /** Book title for vocab context */
  bookTitle?: string
  /** Called when cursor line changes (for relative line numbers) */
  onCursorLineChange?: (info: CursorLineInfo) => void
  /** Current select sub-mode (word or sentence) — controls panel behavior */
  selectSubMode?: 'word' | 'sentence'
}

/**
 * Renders a paragraph, detecting LaTeX and falling back to LatexText rendering
 * when math expressions are found. Otherwise uses word-level interactivity.
 */
function ParagraphRenderer({
  para, pageNumber, selectedWord, onWordClick, flatIndexStart, registerWordSpan, vimSelectedIndices, highlightedIndices, showIndicators,
}: {
  para: any
  pageNumber: number
  selectedWord: NibWord | null
  onWordClick: (word: NibWord, el: HTMLElement) => void
  flatIndexStart: number
  registerWordSpan: (flatIndex: number, el: HTMLSpanElement | null) => void
  vimSelectedIndices?: Set<number>
  highlightedIndices?: Set<number>
  showIndicators?: boolean
}) {
  // Build the full paragraph text and check for special content
  const fullText = para.sentences.map((s: any) => s.text).join(' ')
  const hasLatexContent = containsLatex(fullText)
  const hasTableContent = isTableBlock(fullText)

  // Table rendering
  if (hasTableContent) {
    return <TableRenderer text={fullText} />
  }

  // LaTeX rendering (no word-level interaction for math paragraphs)
  if (hasLatexContent) {
    return (
      <p className="leading-relaxed text-base">
        <LatexText text={fullText} />
      </p>
    )
  }

  // Standard word-by-word rendering with hover/click
  let wordCounter = flatIndexStart
  return (
    <p className="leading-relaxed text-base">
      {para.sentences.map((sentence: any, sIdx: number) => (
        <span key={`s${sIdx}`} className="relative">
          {sentence.words.map((word: NibWord, wIdx: number) => {
            const flatIdx = wordCounter++
            const isVimSelected = vimSelectedIndices?.has(flatIdx)
            const isHighlighted = highlightedIndices?.has(flatIdx)
            const wordSpan = (
              <span
                ref={(el) => registerWordSpan(flatIdx, el)}
                data-word-index={flatIdx}
                className={`cursor-pointer rounded px-px transition-colors hover:bg-primary/10 ${
                  selectedWord === word ? 'bg-primary/20 underline decoration-primary' : ''
                }${isVimSelected ? ' bg-blue-500/25 ring-1 ring-blue-400/50' : ''}${isHighlighted ? ' bg-amber-500/20 ring-1 ring-amber-400/40' : ''}${word.bold ? ' font-bold' : ''}${word.italic ? ' italic' : ''}`}
                onClick={(e) => onWordClick(word, e.currentTarget)}
              >
                {word.text}
              </span>
            )
            return (
              <span key={`w${wIdx}`}>
                {showIndicators ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {wordSpan}
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="bg-background/80 backdrop-blur-xl border border-border/50 rounded-lg shadow-lg shadow-black/10 max-w-sm px-3 py-2"
                    >
                      <p className="font-medium text-sm">{word.text}</p>
                      <p className="text-muted-foreground text-xs mt-1">{sentence.text}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : wordSpan}
                {wIdx < sentence.words.length - 1 ? ' ' : ''}
              </span>
            )
          })}
          {' '}
        </span>
      ))}
    </p>
  )
}

/**
 * Renders a NibDocument with word-level interactivity.
 * Each word is clickable and shows its sentence context on hover.
 * Headers, footnotes, and body paragraphs are visually separated.
 * Element type indicators can be toggled on/off for testing/debugging.
 */
export const NibTextViewer = forwardRef<NibTextViewerHandle, NibTextViewerProps>(function NibTextViewer(
  { nibDocument, sectionTitle, showIndicators = false, onWordSelect, vimSelectedIndices, scrollContainerRef, bookTitle, onCursorLineChange, selectSubMode = 'word' },
  ref
) {
  const [selectedWord, setSelectedWord] = useState<NibWord | null>(null)
  const [wordAnchorEl, setWordAnchorEl] = useState<HTMLElement | null>(null)
  const wordSpanRefs = useRef<Map<number, HTMLSpanElement>>(new Map())
  // Set of flat word indices that are highlighted (sentence selection, line selection, etc.)
  const [highlightedIndices, setHighlightedIndices] = useState<Set<number>>(new Set())

  // Build flat word list from nibDocument for vim-driven selection
  const allWords = useMemo(() => {
    if (!nibDocument) return [] as NibWord[]
    const words: NibWord[] = []
    for (const page of nibDocument.pages) {
      for (const para of page.paragraphs) {
        for (const word of para.allWords) {
          words.push(word)
        }
      }
    }
    return words
  }, [nibDocument])

  // Build flat sentence list
  const allSentences = useMemo(() => {
    if (!nibDocument) return [] as { text: string; words: NibWord[] }[]
    const sentences: { text: string; words: NibWord[] }[] = []
    for (const page of nibDocument.pages) {
      for (const para of page.paragraphs) {
        for (const sent of para.sentences) {
          sentences.push({ text: sent.text, words: sent.words })
        }
      }
    }
    return sentences
  }, [nibDocument])

  // Current vim cursor index
  const vimCursorRef = useRef(0)
  const vimSentenceCursorRef = useRef(0)

  // Cursor line tracking for normal mode j/k
  const cursorLineRef = useRef(0)

  const LINE_HEIGHT = 24 // standard line height for visual line grid

  /**
   * Compute visual lines covering the FULL content height.
   * Creates evenly-spaced lines (every LINE_HEIGHT px) from top to bottom,
   * including blank areas (paragraph gaps, before/after headers, images).
   * Each line records which word indices fall on it.
   */
  const computeVisualLines = useCallback((): { y: number; wordIndices: number[] }[] => {
    const container = scrollContainerRef?.current
    if (!container) return []

    const contentHeight = container.scrollHeight
    if (contentHeight === 0) return []

    const containerRect = container.getBoundingClientRect()
    const scrollTop = container.scrollTop

    // Build a map of which word belongs at which Y position
    const wordYMap: { index: number; y: number }[] = []
    for (let i = 0; i < allWords.length; i++) {
      const span = wordSpanRefs.current.get(i)
      if (!span) continue
      const rect = span.getBoundingClientRect()
      // Absolute Y within the scroll content
      const absY = rect.top - containerRect.top + scrollTop
      wordYMap.push({ index: i, y: absY })
    }

    // Create evenly-spaced lines covering the full content
    const totalLines = Math.max(1, Math.ceil(contentHeight / LINE_HEIGHT))
    const lines: { y: number; wordIndices: number[] }[] = []

    for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
      const lineY = lineIdx * LINE_HEIGHT
      const lineBottom = lineY + LINE_HEIGHT
      // Find words whose Y position falls within this line
      const indices: number[] = []
      for (const { index, y } of wordYMap) {
        if (y >= lineY && y < lineBottom) {
          indices.push(index)
        }
      }
      lines.push({ y: lineY, wordIndices: indices })
    }

    return lines
  }, [allWords, scrollContainerRef])

  // Register a word span element for a given flat index
  const registerWordSpan = useCallback((flatIndex: number, el: HTMLSpanElement | null) => {
    if (el) {
      wordSpanRefs.current.set(flatIndex, el)
    } else {
      wordSpanRefs.current.delete(flatIndex)
    }
  }, [])

  /**
   * Find which visual line a word index belongs to, update cursorLineRef,
   * and report via onCursorLineChange (so RelativeLineNumbers stays in sync).
   */
  const reportCursorLineForWord = useCallback((wordIndex: number) => {
    const lines = computeVisualLines()
    if (lines.length === 0) return
    for (let li = 0; li < lines.length; li++) {
      if (lines[li].wordIndices.includes(wordIndex)) {
        cursorLineRef.current = li
        onCursorLineChange?.({
          cursorLine: li,
          totalLines: lines.length,
          linePositions: lines.map(l => l.y),
        })
        return
      }
    }
  }, [computeVisualLines, onCursorLineChange])

  // Find the first visible word in the scroll container
  const findFirstVisibleWordIndex = useCallback((): number => {
    const container = scrollContainerRef?.current
    if (!container) return 0
    const containerRect = container.getBoundingClientRect()
    // Iterate word spans to find first one within viewport
    for (let i = 0; i < allWords.length; i++) {
      const span = wordSpanRefs.current.get(i)
      if (span) {
        const rect = span.getBoundingClientRect()
        if (rect.top >= containerRect.top && rect.top < containerRect.bottom) {
          return i
        }
      }
    }
    return 0
  }, [allWords, scrollContainerRef])

  // Expose imperative handle for vim engine
  useImperativeHandle(ref, () => ({
    selectWordByDelta(delta: number) {
      if (allWords.length === 0) return
      if (delta === 0) {
        // Select first visible word
        vimCursorRef.current = findFirstVisibleWordIndex()
      } else {
        vimCursorRef.current = Math.max(0, Math.min(allWords.length - 1, vimCursorRef.current + delta))
      }
      const word = allWords[vimCursorRef.current]
      if (word) {
        // Just highlight the word — do NOT show info panel
        setSelectedWord(word)
        setHighlightedIndices(new Set()) // clear sentence highlight
        const span = wordSpanRefs.current.get(vimCursorRef.current)
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
        // Sync cursor line with selected word
        reportCursorLineForWord(vimCursorRef.current)
      }
    },
    selectSentenceByDelta(delta: number) {
      if (allSentences.length === 0) return
      if (delta === 0) {
        const visIdx = findFirstVisibleWordIndex()
        let cumWords = 0
        for (let i = 0; i < allSentences.length; i++) {
          cumWords += allSentences[i].words.length
          if (cumWords > visIdx) {
            vimSentenceCursorRef.current = i
            break
          }
        }
      } else {
        vimSentenceCursorRef.current = Math.max(0, Math.min(allSentences.length - 1, vimSentenceCursorRef.current + delta))
      }
      const sent = allSentences[vimSentenceCursorRef.current]
      if (sent && sent.words.length > 0) {
        const firstWord = sent.words[0]
        setSelectedWord(firstWord)

        // Highlight ALL words in the sentence
        const indices = new Set<number>()
        for (const w of sent.words) {
          for (let i = 0; i < allWords.length; i++) {
            if (allWords[i] === w) { indices.add(i); break }
          }
        }
        setHighlightedIndices(indices)

        // Move vim cursor to first word of sentence
        let flatIdx = 0
        for (let i = 0; i < allWords.length; i++) {
          if (allWords[i] === firstWord) { flatIdx = i; break }
        }
        vimCursorRef.current = flatIdx
        const span = wordSpanRefs.current.get(flatIdx)
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
        // Sync cursor line with first word of sentence
        reportCursorLineForWord(flatIdx)
      }
    },
    selectCurrentLine() {
      const cursorSpan = wordSpanRefs.current.get(vimCursorRef.current)
      if (!cursorSpan) return
      // Handled externally via vimSelectedIndices
    },
    clearVimSelection() {
      setSelectedWord(null)
      setWordAnchorEl(null)
      setHighlightedIndices(new Set())
    },
    confirmSelection() {
      // Show the word info panel for the currently selected word
      const word = allWords[vimCursorRef.current]
      if (!word) return
      setSelectedWord(word)
      const span = wordSpanRefs.current.get(vimCursorRef.current)
      if (span) {
        setWordAnchorEl(span)
      }
      onWordSelect?.(word)
    },
    selectWordVertical(direction: number) {
      // Move word cursor to the nearest word on the line above (direction=-1) or below (direction=1)
      if (allWords.length === 0) return
      const currentSpan = wordSpanRefs.current.get(vimCursorRef.current)
      if (!currentSpan) return

      const currentRect = currentSpan.getBoundingClientRect()
      const currentCenterX = currentRect.left + currentRect.width / 2
      const currentCenterY = currentRect.top + currentRect.height / 2

      let bestIndex = -1
      let bestDistance = Infinity

      // Search through all word spans to find the nearest one on a different visual line
      for (let i = 0; i < allWords.length; i++) {
        if (i === vimCursorRef.current) continue
        const span = wordSpanRefs.current.get(i)
        if (!span) continue

        const rect = span.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2

        // Must be on a different line in the correct direction
        const lineThreshold = currentRect.height * 0.4 // at least 40% of a line height away
        if (direction > 0 && centerY <= currentCenterY + lineThreshold) continue
        if (direction < 0 && centerY >= currentCenterY - lineThreshold) continue

        // Prefer words that are close horizontally (same column) and on the nearest line
        const verticalDist = Math.abs(centerY - currentCenterY)
        const horizontalDist = Math.abs((rect.left + rect.width / 2) - currentCenterX)
        // Weight vertical distance more heavily to prefer the nearest line
        const distance = verticalDist * 3 + horizontalDist

        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }

      if (bestIndex >= 0) {
        vimCursorRef.current = bestIndex
        const word = allWords[bestIndex]
        if (word) {
          setSelectedWord(word)
          const span = wordSpanRefs.current.get(bestIndex)
          if (span) {
            span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
          }
          // Sync cursor line with selected word
          reportCursorLineForWord(bestIndex)
        }
      }
    },
    selectSentenceVertical(direction: number) {
      // Move to the sentence whose first word is on the nearest line above/below
      if (allSentences.length === 0) return

      // Get Y of the first word of current sentence
      const curSent = allSentences[vimSentenceCursorRef.current]
      if (!curSent || curSent.words.length === 0) return

      // Find flat index of the first word of the current sentence
      let curFirstIdx = 0
      for (let i = 0; i < allWords.length; i++) {
        if (allWords[i] === curSent.words[0]) { curFirstIdx = i; break }
      }
      const currentSpan = wordSpanRefs.current.get(curFirstIdx)
      if (!currentSpan) return

      const currentRect = currentSpan.getBoundingClientRect()
      const currentCenterY = currentRect.top + currentRect.height / 2

      // Find the sentence whose first word is on a different line in the correct direction
      let bestSentIdx = -1
      let bestDist = Infinity

      for (let si = 0; si < allSentences.length; si++) {
        if (si === vimSentenceCursorRef.current) continue
        const sent = allSentences[si]
        if (sent.words.length === 0) continue

        // Find flat index of first word
        let firstIdx = -1
        for (let i = 0; i < allWords.length; i++) {
          if (allWords[i] === sent.words[0]) { firstIdx = i; break }
        }
        if (firstIdx < 0) continue

        const span = wordSpanRefs.current.get(firstIdx)
        if (!span) continue

        const rect = span.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2

        // Must be in the correct direction
        const lineThreshold = currentRect.height * 0.4
        if (direction > 0 && centerY <= currentCenterY + lineThreshold) continue
        if (direction < 0 && centerY >= currentCenterY - lineThreshold) continue

        const dist = Math.abs(centerY - currentCenterY)
        if (dist < bestDist) {
          bestDist = dist
          bestSentIdx = si
        }
      }

      if (bestSentIdx >= 0) {
        vimSentenceCursorRef.current = bestSentIdx
        const sent = allSentences[bestSentIdx]
        const firstWord = sent.words[0]
        setSelectedWord(firstWord)

        // Highlight ALL words in the sentence
        const indices = new Set<number>()
        for (const w of sent.words) {
          for (let i = 0; i < allWords.length; i++) {
            if (allWords[i] === w) { indices.add(i); break }
          }
        }
        setHighlightedIndices(indices)

        // Find flat index of first word and sync cursor
        let flatIdx = 0
        for (let i = 0; i < allWords.length; i++) {
          if (allWords[i] === firstWord) { flatIdx = i; break }
        }
        vimCursorRef.current = flatIdx
        const span = wordSpanRefs.current.get(flatIdx)
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
        reportCursorLineForWord(flatIdx)
      }
    },
    moveCursorLine(delta: number) {
      const lines = computeVisualLines()
      if (lines.length === 0) return

      // Move cursor line
      const newLine = Math.max(0, Math.min(lines.length - 1, cursorLineRef.current + delta))
      cursorLineRef.current = newLine

      // Highlight the first word on the cursor line (subtle indicator)
      const line = lines[newLine]
      if (line && line.wordIndices.length > 0) {
        // Scroll the line into view if needed
        const firstSpan = wordSpanRefs.current.get(line.wordIndices[0])
        if (firstSpan) {
          const container = scrollContainerRef?.current
          if (container) {
            const spanRect = firstSpan.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            // Only scroll if the line is out of visible area
            if (spanRect.top < containerRect.top || spanRect.bottom > containerRect.bottom) {
              firstSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            }
          }
        }
      }

      // Report cursor line change
      onCursorLineChange?.({
        cursorLine: newLine,
        totalLines: lines.length,
        linePositions: lines.map(l => l.y),
      })
    },
    getCursorLineInfo() {
      const lines = computeVisualLines()
      return {
        cursorLine: cursorLineRef.current,
        totalLines: lines.length,
        linePositions: lines.map(l => l.y),
      }
    },
  }), [allWords, allSentences, findFirstVisibleWordIndex, onWordSelect, computeVisualLines, onCursorLineChange, scrollContainerRef, reportCursorLineForWord])

  // Report initial line count after content renders
  useEffect(() => {
    if (!onCursorLineChange || allWords.length === 0) return
    // Delay slightly to ensure DOM has rendered word spans
    const timer = setTimeout(() => {
      const lines = computeVisualLines()
      if (lines.length > 0) {
        onCursorLineChange({
          cursorLine: cursorLineRef.current,
          totalLines: lines.length,
          linePositions: lines.map(l => l.y),
        })
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [allWords.length, computeVisualLines, onCursorLineChange])

  const handleWordClick = useCallback((word: NibWord, el: HTMLElement) => {
    setSelectedWord(word)
    setWordAnchorEl(el)
    // Update vim cursor to match clicked word
    for (let i = 0; i < allWords.length; i++) {
      if (allWords[i] === word) { vimCursorRef.current = i; break }
    }
    onWordSelect?.(word)
  }, [onWordSelect, allWords])

  const handleClosePanel = useCallback(() => {
    setSelectedWord(null)
    setWordAnchorEl(null)
  }, [])

  if (!nibDocument) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No parsed content available. Process this chapter first.</p>
      </div>
    )
  }

  // Precompute flat word index offsets for each paragraph
  const paraFlatOffsets = useMemo(() => {
    if (!nibDocument) return new Map<string, number>()
    const offsets = new Map<string, number>()
    let idx = 0
    for (const page of nibDocument.pages) {
      for (const para of page.paragraphs) {
        offsets.set(`${page.pageNumber}-${para.index}`, idx)
        idx += para.allWords.length
      }
    }
    return offsets
  }, [nibDocument])

  return (
    <div className="p-6 space-y-2">
        {/* Section title */}
        <div className="mb-4">
          {showIndicators && <NibElementBadge type="section" />}
          <h2 className="text-xl font-semibold">{sectionTitle}</h2>
        </div>

        {nibDocument.pages.map((page) => (
          <div key={page.pageNumber} className="mb-6">
            {/* Page header (detected from PDF — only shown in indicators mode) */}
            {showIndicators && page.header && (
              <div className="mb-3">
                <NibElementBadge type="header" />
                <div className="text-xs text-muted-foreground/50 italic border-b border-muted pb-1">
                  {page.header.text}
                </div>
              </div>
            )}

            {/* Body paragraphs */}
            {page.paragraphs.map((para) => {
              const blockType: NibBlockType = para.blockType
              const isIntro = blockType === 'introduction'
              const isQuote = blockType === 'blockquote'
              const isEpigraph = blockType === 'epigraph'
              const isSubheading = blockType === 'subheading'
              const flatOffset = paraFlatOffsets.get(`${page.pageNumber}-${para.index}`) ?? 0

              // Render sub-headings through ParagraphRenderer so words are selectable
              if (isSubheading) {
                const text = para.sentences.map((s: any) => s.text).join(' ')
                // Skip if this subheading duplicates the section title
                const normalizedText = text.replace(/^\d+(\.\d+)*\s+/, '').trim().toLowerCase()
                const normalizedTitle = sectionTitle.replace(/^\d+(\.\d+)*\s+/, '').trim().toLowerCase()
                if (normalizedText === normalizedTitle) return null

                return (
                  <div key={`${page.pageNumber}-p${para.index}`} className="mt-6 mb-3">
                    {showIndicators && (
                      <div className="mb-1">
                        <NibElementBadge type={blockType} />
                      </div>
                    )}
                    <div className="text-lg font-bold" role="heading" aria-level={3}>
                      <ParagraphRenderer
                        para={para}
                        pageNumber={page.pageNumber}
                        selectedWord={selectedWord}
                        onWordClick={handleWordClick}
                        flatIndexStart={flatOffset}
                        registerWordSpan={registerWordSpan}
                        vimSelectedIndices={vimSelectedIndices}
                        highlightedIndices={highlightedIndices}
                        showIndicators={false}
                      />
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={`${page.pageNumber}-p${para.index}`}
                  className={`mb-4 ${
                    isIntro ? 'border-l-2 border-teal-500/40 pl-4' : ''
                  }${
                    isQuote ? 'border-l-2 border-indigo-500/40 pl-4 italic' : ''
                  }${
                    isEpigraph ? 'border-l-2 border-violet-500/40 pl-4 italic text-muted-foreground' : ''
                  }`}
                >
                  {showIndicators && (
                    <div className="mb-1">
                      <NibElementBadge type={blockType} />
                      <span className="text-[9px] text-muted-foreground/40 ml-1 font-mono">
                        {para.sentences.length}s · {para.allWords.length}w
                      </span>
                    </div>
                  )}
                  <ParagraphRenderer
                    para={para}
                    pageNumber={page.pageNumber}
                    selectedWord={selectedWord}
                    onWordClick={handleWordClick}
                    flatIndexStart={flatOffset}
                    registerWordSpan={registerWordSpan}
                    vimSelectedIndices={vimSelectedIndices}
                    highlightedIndices={highlightedIndices}
                    showIndicators={showIndicators}
                  />
                </div>
              )
            })}

            {/* List items */}
            {page.listItems.length > 0 && (
              <div className="my-3 space-y-1">
                {showIndicators && <NibElementBadge type="list-item" />}
                {page.listItems.map((item, i) => (
                  <div key={i} className="flex gap-2 text-sm" style={{ paddingLeft: `${item.depth * 16}px` }}>
                    <span className="text-muted-foreground font-mono shrink-0">{item.marker}</span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Figures with images */}
            {page.figures.length > 0 && (
              <div className="my-4 space-y-4">
                {showIndicators && <NibElementBadge type="figure" />}
                {page.figures.map((fig, i) => (
                  <div key={i} className="flex flex-col items-center gap-2">
                    {fig.imageSrc && (
                      <img
                        src={fig.imageSrc}
                        alt={fig.label ? `${fig.label}: ${fig.caption}` : 'Figure'}
                        className="max-w-full h-auto rounded border border-muted"
                      />
                    )}
                    {(fig.label || fig.caption) && (
                      <p className="text-sm text-muted-foreground text-center">
                        {fig.label && <span className="font-semibold">{fig.label}.</span>}
                        {fig.caption && ` ${fig.caption}`}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Footnotes */}
            {page.footnotes.length > 0 && (
              <div className="mt-4 pt-2 border-t border-muted">
                {showIndicators && <NibElementBadge type="footnote" />}
                {page.footnotes.map((fn, i) => (
                  <p key={i} className="text-xs text-muted-foreground mb-1">
                    <sup className="font-medium">{fn.marker}</sup> {fn.text}
                  </p>
                ))}
              </div>
            )}

            {/* Footer (usually page number — only shown in indicators mode) */}
            {showIndicators && page.footer && (
              <div className="mt-2">
                <NibElementBadge type="footer" />
                <div className="text-xs text-muted-foreground/40 text-center">
                  {page.footer.text}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Floating word info panel — only when anchor is set (click or Enter) */}
        {selectedWord && wordAnchorEl && (
          <WordInfoPanel
            word={selectedWord}
            anchorEl={wordAnchorEl}
            showIndicators={showIndicators}
            onClose={handleClosePanel}
            bookTitle={bookTitle}
            sectionTitle={sectionTitle}
            panelMode={selectSubMode}
          />
        )}
    </div>
  )
})
