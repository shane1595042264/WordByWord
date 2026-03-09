'use client'

import { useState, useCallback } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NibElementBadge } from '@/components/ui/block-tooltip'
import { LatexText, containsLatex } from '@/components/reader/latex-renderer'
import { isTableBlock, TableRenderer } from '@/components/reader/table-renderer'
import type { NibDocument, NibWord, NibBlockType } from '@/lib/nib'

interface NibTextViewerProps {
  nibDocument: NibDocument | null
  sectionTitle: string
  /** Whether to show element type indicators (paragraph, header, etc.) */
  showIndicators?: boolean
  /** Called when a word is tapped — parent can use word.getAIContext() for translation */
  onWordSelect?: (word: NibWord) => void
}

/**
 * Renders a paragraph, detecting LaTeX and falling back to LatexText rendering
 * when math expressions are found. Otherwise uses word-level interactivity.
 */
function ParagraphRenderer({
  para, pageNumber, selectedWord, onWordClick,
}: {
  para: any
  pageNumber: number
  selectedWord: NibWord | null
  onWordClick: (word: NibWord) => void
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
  return (
    <p className="leading-relaxed text-base">
      {para.sentences.map((sentence: any) => (
        <span key={`s${sentence.index}`} className="relative">
          {sentence.words.map((word: NibWord, wIdx: number) => (
            <span key={`w${wIdx}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={`cursor-pointer rounded px-px transition-colors hover:bg-primary/10 ${
                      selectedWord === word ? 'bg-primary/20 underline decoration-primary' : ''
                    }${word.bold ? ' font-bold' : ''}${word.italic ? ' italic' : ''}`}
                    onClick={() => onWordClick(word)}
                  >
                    {word.text}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="
                    bg-background/80 backdrop-blur-xl
                    border border-border/50
                    rounded-lg shadow-lg shadow-black/10
                    max-w-sm px-3 py-2
                  "
                >
                  <p className="font-medium text-sm">{word.text}</p>
                  <p className="text-muted-foreground text-xs mt-1">
                    {sentence.text}
                  </p>
                </TooltipContent>
              </Tooltip>
              {wIdx < sentence.words.length - 1 ? ' ' : ''}
            </span>
          ))}
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
export function NibTextViewer({ nibDocument, sectionTitle, showIndicators = false, onWordSelect }: NibTextViewerProps) {
  const [selectedWord, setSelectedWord] = useState<NibWord | null>(null)

  const handleWordClick = useCallback((word: NibWord) => {
    setSelectedWord(word)
    onWordSelect?.(word)
  }, [onWordSelect])

  if (!nibDocument) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground p-8">
        <p>No parsed content available. Process this chapter first.</p>
      </div>
    )
  }

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

        {/* Selected word context panel */}
        {selectedWord && (
          <div className="
            fixed bottom-4 left-1/2 -translate-x-1/2
            bg-background/80 backdrop-blur-xl
            border border-border/50
            rounded-lg shadow-lg shadow-black/10
            p-4 max-w-md z-50
          ">
            <div className="flex items-center justify-between mb-2">
              {showIndicators && <NibElementBadge type="word" />}
              <span className="font-bold text-lg ml-1">{selectedWord.text}</span>
              <button
                className="text-muted-foreground hover:text-foreground text-sm"
                onClick={() => setSelectedWord(null)}
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              <span className="font-medium">Sentence:</span> {selectedWord.sentence.text}
            </p>
            <p className="text-xs text-muted-foreground">
              Page {selectedWord.page.pageNumber} · Paragraph {selectedWord.paragraph.index + 1} · Word {selectedWord.index + 1}
            </p>
          </div>
        )}
    </div>
  )
}
