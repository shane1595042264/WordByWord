'use client'

import { useState, useCallback } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { NibElementBadge } from '@/components/ui/block-tooltip'
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
    <ScrollArea className="h-full">
      <div className="max-w-none p-6 space-y-2">
        {/* Section title */}
        <div className="mb-4">
          {showIndicators && <NibElementBadge type="section" />}
          <h2 className="text-xl font-semibold">{sectionTitle}</h2>
        </div>

        {nibDocument.pages.map((page) => (
          <div key={page.pageNumber} className="mb-6">
            {/* Page header (detected from PDF — not shown in body) */}
            {page.header && (
              <div className="mb-3">
                {showIndicators && <NibElementBadge type="header" />}
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
                  <p className="leading-relaxed text-base">
                    {para.sentences.map((sentence) => (
                      <span key={`s${sentence.index}`} className="relative">
                        {sentence.words.map((word, wIdx) => (
                          <span key={`w${wIdx}`}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className={`cursor-pointer rounded px-px transition-colors hover:bg-primary/10 ${
                                    selectedWord === word ? 'bg-primary/20 underline decoration-primary' : ''
                                  }`}
                                  onClick={() => handleWordClick(word)}
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

            {/* Figure captions */}
            {page.figures.length > 0 && (
              <div className="my-3 space-y-1">
                {showIndicators && <NibElementBadge type="figure" />}
                {page.figures.map((fig, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    <span className="font-semibold">{fig.label}.</span> {fig.caption}
                  </p>
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

            {/* Footer (usually page number — shown subtly) */}
            {page.footer && (
              <div className="mt-2">
                {showIndicators && <NibElementBadge type="footer" />}
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
    </ScrollArea>
  )
}
