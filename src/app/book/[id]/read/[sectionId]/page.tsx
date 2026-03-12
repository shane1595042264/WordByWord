'use client'

import { use, useCallback, useMemo, useRef, useState, useEffect, type MutableRefObject } from 'react'
import { useRouter } from 'next/navigation'
import { useReader } from '@/hooks/use-reader'
import { useAutoTrack } from '@/hooks/use-auto-track'
import { useShortcut } from '@/hooks/use-shortcuts'
import { PDFViewer } from '@/components/reader/pdf-viewer'
import { TextViewer } from '@/components/reader/text-viewer'
import { NibTextViewer, type NibTextViewerHandle, type CursorLineInfo } from '@/components/reader/nib-text-viewer'
import { SideBySideViewer } from '@/components/reader/side-by-side-viewer'
import { TocViewer } from '@/components/reader/toc-viewer'
import { SectionSidebar } from '@/components/reader/section-sidebar'
import { ReaderToolbar } from '@/components/reader/reader-toolbar'
import { VimStatusBar } from '@/components/reader/vim-status-bar'
import { RelativeLineNumbers } from '@/components/reader/relative-line-numbers'
import { useVimMode, getEffectiveRulebook } from '@/lib/vim'
import { NibService } from '@/lib/services/nib-service'
import type { NibDocument } from '@/lib/nib'
import type { VimRule } from '@/lib/vim'

export default function ReaderPage({ params }: { params: Promise<{ id: string; sectionId: string }> }) {
  const { id: bookId, sectionId } = use(params)
  const router = useRouter()
  /** Restore params from Continue Reading (read once on mount from URL) */
  const restoreRef = useRef<{ scrollProgress: number | null; wordIndex: number | null; applied: boolean } | null>(null)
  if (restoreRef.current === null) {
    // Parse once on initial render (safe in client component)
    const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    restoreRef.current = {
      scrollProgress: qs?.get('sp') ? Number(qs.get('sp')) : null,
      wordIndex: qs?.get('wi') ? Number(qs.get('wi')) : null,
      applied: false,
    }
  }
  const {
    book, section, chapterSections,
    viewMode, setViewMode,
    readingMode, setReadingMode,
    prevSection, nextSection,
    loading, refreshReadStatus,
  } = useReader(bookId, sectionId)

  const contentRef = useRef<HTMLDivElement>(null)
  const textScrollRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>
  const [sectionProgress, setSectionProgress] = useState(0)
  const [showIndicators, setShowIndicators] = useState(false)
  const [syncScroll, setSyncScroll] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const nibTextViewerRef = useRef<NibTextViewerHandle>(null)
  const [effectiveRulebook, setEffectiveRulebook] = useState<VimRule[]>([])
  const [cursorLine, setCursorLine] = useState(0)
  const [totalVisualLines, setTotalVisualLines] = useState(0)
  const [lastTextLine, setLastTextLine] = useState(0)
  const [linePositions, setLinePositions] = useState<number[]>([])
  const [yankFlash, setYankFlash] = useState('')
  const [sideBySideTextProgress, setSideBySideTextProgress] = useState(0)
  /** Flat word index of the currently selected word (for position restore) */
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null)

  // Hoisted callback for cursor line changes (avoids useCallback in JSX)
  const handleCursorLineChange = useCallback((info: CursorLineInfo) => {
    setCursorLine(info.cursorLine)
    setTotalVisualLines(info.totalLines)
    setLastTextLine(info.lastTextLine)
    setLinePositions(info.linePositions)
    // Track word index for position restore
    const idx = nibTextViewerRef.current?.getVimCursorIndex()
    if (idx !== undefined) setSelectedWordIndex(idx)
  }, [])

  // Load user keymap overrides on mount
  useEffect(() => {
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      const svc = new SettingsService()
      const overrides = svc.getSettings().keymapOverrides ?? {}
      setEffectiveRulebook(getEffectiveRulebook(overrides))
    })
  }, [])

  // ── Vim engine (always enabled for text and side-by-side modes) ──
  const vim = useVimMode({
    enabled: viewMode === 'text' || viewMode === 'side-by-side',
    scrollRef: textScrollRef,
    onSelectWord: useCallback((delta: number) => {
      nibTextViewerRef.current?.selectWordByDelta(delta)
    }, []),
    onSelectSentence: useCallback((delta: number) => {
      nibTextViewerRef.current?.selectSentenceByDelta(delta)
    }, []),
    onSelectLine: useCallback(() => {
      nibTextViewerRef.current?.selectCurrentLine()
    }, []),
    onSelectToEnd: useCallback(() => {
      nibTextViewerRef.current?.selectToEnd()
    }, []),
    onSelectToStart: useCallback(() => {
      nibTextViewerRef.current?.selectToStart()
    }, []),
    onYank: useCallback(() => {
      const text = nibTextViewerRef.current?.getSelectedText()
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const preview = text.length > 40 ? text.slice(0, 40) + '…' : text
          setYankFlash(`Copied: "${preview}"`)
          setTimeout(() => setYankFlash(''), 1500)
        }).catch(() => {
          // Fallback for browsers that block clipboard API
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          setYankFlash('Copied!')
          setTimeout(() => setYankFlash(''), 1500)
        })
      }
    }, []),
    onClearSelection: useCallback(() => {
      nibTextViewerRef.current?.clearVimSelection()
    }, []),
    onConfirmSelection: useCallback(() => {
      nibTextViewerRef.current?.confirmSelection()
    }, []),
    onSelectWordVertical: useCallback((direction: number) => {
      nibTextViewerRef.current?.selectWordVertical(direction)
    }, []),
    onSelectSentenceVertical: useCallback((direction: number) => {
      nibTextViewerRef.current?.selectSentenceVertical(direction)
    }, []),
    rulebook: effectiveRulebook.length > 0 ? effectiveRulebook : undefined,
  })

  // Select first visible word when entering text/side-by-side mode (normal mode = word cursor)
  // On first load, restore to saved word index if available from Continue Reading params
  useEffect(() => {
    if (viewMode === 'text' || viewMode === 'side-by-side') {
      const t = setTimeout(() => {
        const restore = restoreRef.current
        if (restore && !restore.applied && restore.wordIndex != null) {
          // Restore to exact word position
          nibTextViewerRef.current?.selectWordByIndex(restore.wordIndex)
          restore.applied = true
        } else if (restore && !restore.applied && restore.scrollProgress != null) {
          // Restore scroll position (no word selected)
          const el = textScrollRef.current
          if (el) {
            const maxScroll = el.scrollHeight - el.clientHeight
            el.scrollTop = (restore.scrollProgress / 100) * maxScroll
          }
          nibTextViewerRef.current?.selectWordByDelta(0)
          restore.applied = true
        } else {
          nibTextViewerRef.current?.selectWordByDelta(0)
        }
      }, 300) // Slightly longer delay for content to render
      return () => clearTimeout(t)
    }
  }, [viewMode])

  // Compute effective progress: cursor line / last text line for text modes,
  // text-side scroll for side-by-side, PDF scroll for PDF mode
  const effectiveProgress = useMemo(() => {
    if ((viewMode === 'text' || viewMode === 'side-by-side') && lastTextLine > 0) {
      return Math.min(100, Math.round((cursorLine / lastTextLine) * 100))
    }
    if (viewMode === 'side-by-side') {
      return sideBySideTextProgress
    }
    return sectionProgress
  }, [cursorLine, lastTextLine, sectionProgress, viewMode, sideBySideTextProgress])

  // ── Auto-save last-accessed position (for Continue Reading) ──
  const positionRef = useRef({ sectionId, progress: 0, wordIndex: null as number | null })

  useEffect(() => { positionRef.current.sectionId = sectionId }, [sectionId])
  useEffect(() => { positionRef.current.progress = effectiveProgress }, [effectiveProgress])
  useEffect(() => { positionRef.current.wordIndex = selectedWordIndex }, [selectedWordIndex])

  // Debounced save: fires 2s after any position change
  useEffect(() => {
    if (!bookId || !sectionId) return
    const timer = setTimeout(() => {
      import('@/lib/repositories').then(({ BookRepository }) => {
        const repo = new BookRepository()
        repo.updateLastAccessed(
          bookId,
          positionRef.current.sectionId,
          positionRef.current.progress,
          positionRef.current.wordIndex,
        )
      })
    }, 2000)
    return () => clearTimeout(timer)
  }, [bookId, sectionId, effectiveProgress, selectedWordIndex])

  // Save immediately on page unload (best-effort)
  useEffect(() => {
    const handleBeforeUnload = () => {
      import('@/lib/repositories').then(({ BookRepository }) => {
        const repo = new BookRepository()
        repo.updateLastAccessed(
          bookId,
          positionRef.current.sectionId,
          positionRef.current.progress,
          positionRef.current.wordIndex,
        )
      })
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [bookId])

  // ── Page-level navigation ──
  const startPage = section?.startPage ?? 1
  const endPage = section?.endPage ?? 1

  const [currentPage, setCurrentPage] = useState(startPage)

  // Reset page/progress when section changes, resume from lastPageViewed if available
  useEffect(() => {
    if (section) {
      setCurrentPage(section.lastPageViewed ?? section.startPage)
      setSectionProgress(section.scrollProgress ?? 0)
    }
  }, [section?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // In text mode, all section text is shown at once — no page-level navigation.
  // Prev/Next should jump directly to prev/next section.
  const isTextMode = viewMode === 'text'
  const canGoPrev = isTextMode ? !!prevSection : (currentPage > startPage || !!prevSection)
  const canGoNext = isTextMode ? !!nextSection : (currentPage < endPage || !!nextSection)

  const goToPrevPage = useCallback(() => {
    if (isTextMode) {
      if (prevSection) router.push(`/book/${bookId}/read/${prevSection.id}`)
      return
    }
    if (currentPage > startPage) {
      setCurrentPage(p => p - 1)
    } else if (prevSection) {
      router.push(`/book/${bookId}/read/${prevSection.id}`)
    }
  }, [isTextMode, currentPage, startPage, prevSection, bookId, router])

  const goToNextPage = useCallback(() => {
    if (isTextMode) {
      if (nextSection) router.push(`/book/${bookId}/read/${nextSection.id}`)
      return
    }
    if (currentPage < endPage) {
      setCurrentPage(p => p + 1)
    } else if (nextSection) {
      router.push(`/book/${bookId}/read/${nextSection.id}`)
    }
  }, [isTextMode, currentPage, endPage, nextSection, bookId, router])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  // Parse section text through .nib pipeline
  // Prefer rich PDF parsing (with font/bold info) when PDF blob is available.
  // Falls back to flat text parsing for scanned/AI-extracted text.
  const [nibDocument, setNibDocument] = useState<NibDocument | null>(null)

  // Effective end page: always include at least the next section's start page
  // so the PDF shows all content that the nib parser merged (cross-page paragraphs).
  // This means sections can overlap on the PDF side — that's fine, we'll show
  // a divider line so the reader knows where the section boundary is.
  const effectiveEndPage = useMemo(() => {
    let ep = endPage
    // Include pages from nibDocument if it parsed more
    if (nibDocument) {
      ep = Math.max(ep, startPage + nibDocument.pages.length - 1)
    }
    // Always extend to include the next section's start page (overlap)
    if (nextSection?.startPage && nextSection.startPage > endPage) {
      ep = Math.max(ep, nextSection.startPage)
    }
    return ep
  }, [endPage, startPage, nibDocument, nextSection?.startPage])
  const totalSectionPages = effectiveEndPage - startPage + 1

  useEffect(() => {
    if (!section?.extractedText || !book) { setNibDocument(null); return }

    let cancelled = false
    const isIntroSection = /introduction$/i.test(section.title.replace(/\s*—\s*/, ' ').trim())

    // Try rich PDF parsing first (preserves bold/italic font info)
    if (book.pdfBlob) {
      const nibService = new NibService()
      nibService.parsePages(
        book.pdfBlob,
        section.startPage,
        section.endPage,
        book.title,
        book.author,
        isIntroSection ? undefined : section.title,
        nextSection?.title,
        nextSection?.startPage,
      ).then(doc => {
        if (!cancelled) setNibDocument(doc)
      }).catch(() => {
        // Fallback to text-based parsing
        if (!cancelled) {
          try {
            const fallbackService = new NibService()
            if (isIntroSection) {
              setNibDocument(fallbackService.parseExtractedTextIntroOnly(
                section.extractedText!,
                book.title,
                book.author,
                section.startPage,
              ))
            } else {
              setNibDocument(fallbackService.parseExtractedTextBodyOnly(
                section.extractedText!,
                book.title,
                book.author,
                section.startPage,
                section.title,
              ))
            }
          } catch { setNibDocument(null) }
        }
      })
    } else {
      // Text-based parsing (when no PDF blob)
      try {
        const nibService = new NibService()
        if (isIntroSection) {
          setNibDocument(nibService.parseExtractedTextIntroOnly(
            section.extractedText,
            book.title,
            book.author,
            section.startPage,
          ))
        } else {
          setNibDocument(nibService.parseExtractedTextBodyOnly(
            section.extractedText,
            book.title,
            book.author,
            section.startPage,
            section.title,
          ))
        }
      } catch { setNibDocument(null) }
    }

    return () => { cancelled = true }
  }, [section?.extractedText, section?.title, book, section?.startPage, section?.endPage, nextSection?.title, nextSection?.startPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkedRead = useCallback(() => { refreshReadStatus() }, [refreshReadStatus])

  // Only track after loading completes to ensure scroll containers are mounted
  useAutoTrack(sectionId, loading ? true : (section?.isRead ?? false), handleMarkedRead, contentRef, textScrollRef, viewMode)

  const handlePageProgress = useCallback((currentPage: number, totalPages: number, scrollPercent: number) => {
    setSectionProgress(scrollPercent)
    import('@/lib/db/database').then(({ db }) => {
      db.sections.update(sectionId, {
        lastPageViewed: currentPage,
        scrollProgress: scrollPercent,
      })
    })
  }, [sectionId])

  // ── Text mode scroll tracking ──
  const handleTextScroll = useCallback(() => {
    const el = textScrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    if (maxScroll <= 0) {
      // Content fits without scrolling — 100% immediately
      setSectionProgress(100)
      return
    }
    const percent = Math.min(100, Math.round((scrollTop / maxScroll) * 100))
    setSectionProgress(percent)
    // Persist scroll progress
    import('@/lib/db/database').then(({ db }) => {
      db.sections.update(sectionId, { scrollProgress: percent })
    })
  }, [sectionId])

  // Track a flag so the effect can re-trigger once loading completes and the ref mounts
  const [textScrollReady, setTextScrollReady] = useState(false)

  // Use a callback ref to detect when the text scroll container mounts
  const textScrollCallbackRef = useCallback((node: HTMLDivElement | null) => {
    textScrollRef.current = node
    setTextScrollReady(!!node)
  }, [])

  // Check initial text scroll state when text view mounts (e.g. content fits without scrolling)
  useEffect(() => {
    if (viewMode !== 'text') return
    if (!textScrollRef.current) return
    // Delay to let content render fully
    const timer = setTimeout(() => handleTextScroll(), 300)
    return () => clearTimeout(timer)
  }, [viewMode, textScrollReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ──
  useShortcut('toggle-indicators', 'Toggle Element Labels', 'Ctrl+i', useCallback(() => {
    setShowIndicators(prev => !prev)
  }, []))

  useShortcut('view-pdf', 'PDF View', 'Ctrl+1', useCallback(() => {
    setViewMode('pdf')
  }, [setViewMode]))

  useShortcut('view-text', 'Text View', 'Ctrl+2', useCallback(() => {
    setViewMode('text')
  }, [setViewMode]))

  useShortcut('view-side-by-side', 'Side-by-Side View', 'Ctrl+3', useCallback(() => {
    setViewMode('side-by-side')
  }, [setViewMode]))

  useShortcut('toggle-line-numbers', 'Toggle Line Numbers', 'Ctrl+Shift+l', useCallback(() => {
    setShowLineNumbers(prev => !prev)
  }, []))

  useShortcut('prev-page', 'Previous Page', 'Ctrl+ArrowLeft', goToPrevPage)
  useShortcut('next-page', 'Next Page', 'Ctrl+ArrowRight', goToNextPage)

  // Persist currentPage to DB
  useEffect(() => {
    if (!section) return
    import('@/lib/db/database').then(({ db }) => {
      db.sections.update(sectionId, { lastPageViewed: currentPage })
    })
  }, [currentPage, sectionId, section])

  if (loading || !book || !section) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  return (
    <div className="flex flex-col h-screen">
      <ReaderToolbar
        bookId={bookId}
        sectionTitle={section.title}
        isRead={section.isRead}
        sectionId={sectionId}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        readingMode={readingMode}
        onReadingModeChange={setReadingMode}
        onReadToggle={refreshReadStatus}
        sectionProgress={effectiveProgress}
        showIndicators={showIndicators}
        onToggleIndicators={() => setShowIndicators(prev => !prev)}
        syncScroll={syncScroll}
        onSyncScrollChange={setSyncScroll}
        currentPage={currentPage}
        totalSectionPages={totalSectionPages}
        startPage={startPage}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        showLineNumbers={showLineNumbers}
        onLineNumbersToggle={() => setShowLineNumbers(prev => !prev)}
      />
      <div className="flex flex-1 overflow-hidden">
        <SectionSidebar
          bookId={bookId}
          sections={chapterSections}
          currentSectionId={sectionId}
        />
        <div className="flex-1 overflow-hidden flex flex-col" ref={contentRef}>
          {viewMode === 'pdf' && (
            <PDFViewer
              pdfBlob={book.pdfBlob}
              startPage={section.startPage}
              endPage={effectiveEndPage}
              readingMode={readingMode}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onPageProgress={handlePageProgress}
              sectionEndPage={section.endPage}
            />
          )}
          {viewMode === 'text' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 flex overflow-hidden">
                <RelativeLineNumbers
                  scrollContainerRef={textScrollRef}
                  enabled={showLineNumbers}
                  cursorLine={cursorLine}
                  totalLines={totalVisualLines}
                  linePositions={linePositions}
                />
              <div className="flex-1 overflow-auto" ref={textScrollCallbackRef} onScroll={handleTextScroll}>
                {/^(table of )?contents$/i.test(section.title) && section.extractedText ? (
                  <TocViewer
                    bookId={bookId}
                    extractedText={section.extractedText}
                    sectionTitle={section.title}
                  />
                ) : nibDocument ? (
                  <NibTextViewer
                    ref={nibTextViewerRef}
                    nibDocument={nibDocument}
                    sectionTitle={section.title}
                    showIndicators={showIndicators}
                    scrollContainerRef={textScrollRef}
                    bookTitle={book.title}
                    onCursorLineChange={handleCursorLineChange}
                    vimMode={vim.mode}
                  />
                ) : (
                  <TextViewer text={section.extractedText} sectionTitle={section.title} />
                )}
              </div>
              </div>
              <VimStatusBar mode={vim.mode} countBuffer={vim.countBuffer} enabled={true} flashMessage={yankFlash} />
            </div>
          )}
          {viewMode === 'side-by-side' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <SideBySideViewer
                  pdfBlob={book.pdfBlob}
                  startPage={section.startPage}
                  endPage={effectiveEndPage}
                  text={section.extractedText}
                  nibDocument={nibDocument}
                  sectionTitle={section.title}
                  readingMode={readingMode}
                  showIndicators={showIndicators}
                  currentPage={currentPage}
                  onPageChange={handlePageChange}
                  onPageProgress={handlePageProgress}
                  syncScroll={syncScroll}
                  nibTextViewerRef={nibTextViewerRef}
                  bookTitle={book.title}
                  vimMode={vim.mode}
                  sectionEndPage={section.endPage}
                  showLineNumbers={showLineNumbers}
                  onTextScrollProgress={setSideBySideTextProgress}
                />
              </div>
              <VimStatusBar mode={vim.mode} countBuffer={vim.countBuffer} enabled={true} flashMessage={yankFlash} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
