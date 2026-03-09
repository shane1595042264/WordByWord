'use client'

import { use, useCallback, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useReader } from '@/hooks/use-reader'
import { useAutoTrack } from '@/hooks/use-auto-track'
import { useShortcut } from '@/hooks/use-shortcuts'
import { PDFViewer } from '@/components/reader/pdf-viewer'
import { TextViewer } from '@/components/reader/text-viewer'
import { NibTextViewer } from '@/components/reader/nib-text-viewer'
import { SideBySideViewer } from '@/components/reader/side-by-side-viewer'
import { TocViewer } from '@/components/reader/toc-viewer'
import { SectionSidebar } from '@/components/reader/section-sidebar'
import { ReaderToolbar } from '@/components/reader/reader-toolbar'
import { NibService } from '@/lib/services/nib-service'
import type { NibDocument } from '@/lib/nib'

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

  // ── Page-level navigation ──
  const startPage = section?.startPage ?? 1
  const endPage = section?.endPage ?? 1
  const totalSectionPages = endPage - startPage + 1

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

  useEffect(() => {
    if (!section?.extractedText || !book) { setNibDocument(null); return }

    let cancelled = false
    const isIntroSection = /introduction$/i.test(section.title.replace(/\s*—\s*/, ' ').trim())

    // Try rich PDF parsing first (preserves bold/italic font info)
    if (book.pdfBlob && !isIntroSection) {
      const nibService = new NibService()
      nibService.parsePages(
        book.pdfBlob,
        section.startPage,
        section.endPage,
        book.title,
        book.author,
        section.title,
      ).then(doc => {
        if (!cancelled) setNibDocument(doc)
      }).catch(() => {
        // Fallback to text-based parsing
        if (!cancelled) {
          try {
            const fallbackService = new NibService()
            setNibDocument(fallbackService.parseExtractedTextBodyOnly(
              section.extractedText!,
              book.title,
              book.author,
              section.startPage,
              section.title,
            ))
          } catch { setNibDocument(null) }
        }
      })
    } else {
      // Text-based parsing (for intro sections or when no PDF blob)
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
  }, [section?.extractedText, section?.title, book, section?.startPage, section?.endPage]) // eslint-disable-line react-hooks/exhaustive-deps

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
        currentPage={currentPage}
        totalSectionPages={totalSectionPages}
        startPage={startPage}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
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
              endPage={section.endPage}
              readingMode={readingMode}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onPageProgress={handlePageProgress}
            />
          )}
          {viewMode === 'text' && (
            <div className="flex-1 overflow-auto" ref={textScrollCallbackRef} onScroll={handleTextScroll}>
              {/^(table of )?contents$/i.test(section.title) && section.extractedText ? (
                <TocViewer
                  bookId={bookId}
                  extractedText={section.extractedText}
                  sectionTitle={section.title}
                />
              ) : nibDocument ? (
                <NibTextViewer
                  nibDocument={nibDocument}
                  sectionTitle={section.title}
                  showIndicators={showIndicators}
                />
              ) : (
                <TextViewer text={section.extractedText} sectionTitle={section.title} />
              )}
            </div>
          )}
          {viewMode === 'side-by-side' && (
            <SideBySideViewer
              pdfBlob={book.pdfBlob}
              startPage={section.startPage}
              endPage={section.endPage}
              text={section.extractedText}
              nibDocument={nibDocument}
              sectionTitle={section.title}
              readingMode={readingMode}
              showIndicators={showIndicators}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onPageProgress={handlePageProgress}
            />
          )}
        </div>
      </div>
    </div>
  )
}
