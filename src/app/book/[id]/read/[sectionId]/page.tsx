'use client'

import { use, useCallback, useRef, useState, useEffect } from 'react'
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
  const {
    book, section, chapterSections,
    viewMode, setViewMode,
    readingMode, setReadingMode,
    prevSection, nextSection,
    loading, refreshReadStatus,
  } = useReader(bookId, sectionId)

  const contentRef = useRef<HTMLDivElement>(null)
  const textScrollRef = useRef<HTMLDivElement>(null)
  const [sectionProgress, setSectionProgress] = useState(0)
  const [showIndicators, setShowIndicators] = useState(false)
  const [syncScroll, setSyncScroll] = useState(true)
  const [vimEnabled, setVimEnabled] = useState(false)
  const nibTextViewerRef = useRef<NibTextViewerHandle>(null)
  const [effectiveRulebook, setEffectiveRulebook] = useState<VimRule[]>([])
  const [cursorLine, setCursorLine] = useState(0)
  const [totalVisualLines, setTotalVisualLines] = useState(0)
  const [linePositions, setLinePositions] = useState<number[]>([])

  // Hoisted callback for cursor line changes (avoids useCallback in JSX)
  const handleCursorLineChange = useCallback((info: CursorLineInfo) => {
    setCursorLine(info.cursorLine)
    setTotalVisualLines(info.totalLines)
    setLinePositions(info.linePositions)
  }, [])

  // Load user keymap overrides on mount
  useEffect(() => {
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      const svc = new SettingsService()
      const overrides = svc.getSettings().keymapOverrides ?? {}
      setEffectiveRulebook(getEffectiveRulebook(overrides))
    })
  }, [])

  // ── Vim engine ──
  const vim = useVimMode({
    enabled: vimEnabled && (viewMode === 'text' || viewMode === 'side-by-side'),
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
    onCursorLine: useCallback((direction: number) => {
      nibTextViewerRef.current?.moveCursorLine(direction)
    }, []),
    rulebook: effectiveRulebook.length > 0 ? effectiveRulebook : undefined,
  })

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

  // Effective end page includes any extra pages the nib parser added
  // (when section text continues past the assigned page range)
  const effectiveEndPage = nibDocument
    ? Math.max(endPage, startPage + nibDocument.pages.length - 1)
    : endPage
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
    (textScrollRef as any).current = node
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

  useShortcut('toggle-vim', 'Toggle Vim Mode', 'Ctrl+Shift+v', useCallback(() => {
    setVimEnabled(prev => !prev)
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
        sectionProgress={sectionProgress}
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
        vimEnabled={vimEnabled}
        onVimToggle={() => setVimEnabled(prev => !prev)}
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
            />
          )}
          {viewMode === 'text' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 flex overflow-hidden">
                <RelativeLineNumbers
                  scrollContainerRef={textScrollRef}
                  enabled={vimEnabled}
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
              <VimStatusBar mode={vim.mode} countBuffer={vim.countBuffer} enabled={vim.enabled} />
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
                />
              </div>
              <VimStatusBar mode={vim.mode} countBuffer={vim.countBuffer} enabled={vim.enabled} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
