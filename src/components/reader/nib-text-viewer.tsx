'use client'

import { useState, useCallback, useRef, useMemo, useImperativeHandle, forwardRef } from 'react'
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
}

/**
 * Renders a paragraph, detecting LaTeX and falling back to LatexText rendering
 * when math expressions are found. Otherwise uses word-level interactivity.
 */
function ParagraphRenderer({
  para, pageNumber, selectedWord, onWordClick, flatIndexStart, registerWordSpan, vimSelectedIndices, showIndicators,
}: {
  para: any
  pageNumber: number
  selectedWord: NibWord | null
  onWordClick: (word: NibWord, el: HTMLElement) => void
  flatIndexStart: number
  registerWordSpan: (flatIndex: number, el: HTMLSpanElement | null) => void
  vimSelectedIndices?: Set<number>
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
            const wordSpan = (
              <span
                ref={(el) => registerWordSpan(flatIdx, el)}
                data-word-index={flatIdx}
                className={`cursor-pointer rounded px-px transition-colors hover:bg-primary/10 ${
                  selectedWord === word ? 'bg-primary/20 underline decoration-primary' : ''
                }${isVimSelected ? ' bg-blue-500/25 ring-1 ring-blue-400/50' : ''}${word.bold ? ' font-bold' : ''}${word.italic ? ' italic' : ''}`}
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
  { nibDocument, sectionTitle, showIndicators = false, onWordSelect, vimSelectedIndices, scrollContainerRef },
  ref
) {
  const [selectedWord, setSelectedWord] = useState<NibWord | null>(null)
  const [wordAnchorEl, setWordAnchorEl] = useState<HTMLElement | null>(null)
  const wordSpanRefs = useRef<Map<number, HTMLSpanElement>>(new Map())

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

  // Register a word span element for a given flat index
  const registerWordSpan = useCallback((flatIndex: number, el: HTMLSpanElement | null) => {
    if (el) {
      wordSpanRefs.current.set(flatIndex, el)
    } else {
      wordSpanRefs.current.delete(flatIndex)
    }
  }, [])

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
        const span = wordSpanRefs.current.get(vimCursorRef.current)
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
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
        // Just highlight — do NOT show info panel
        setSelectedWord(firstWord)
        let flatIdx = 0
        for (let i = 0; i < allWords.length; i++) {
          if (allWords[i] === firstWord) { flatIdx = i; break }
        }
        vimCursorRef.current = flatIdx
        const span = wordSpanRefs.current.get(flatIdx)
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
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
  }), [allWords, allSentences, findFirstVisibleWordIndex, onWordSelect])

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

              // Render sub-headings as styled h3 elements
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
                    <h3 className="text-lg font-bold">{text}</h3>
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
          />
        )}
    </div>
  )
})
