'use client'

import { use, useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useReader } from '@/hooks/use-reader'
import { useAutoTrack } from '@/hooks/use-auto-track'
import { useShortcut } from '@/hooks/use-shortcuts'
import { PDFViewer } from '@/components/reader/pdf-viewer'
import { TextViewer } from '@/components/reader/text-viewer'
import { NibTextViewer } from '@/components/reader/nib-text-viewer'
import { SideBySideViewer } from '@/components/reader/side-by-side-viewer'
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
  const [sectionProgress, setSectionProgress] = useState(0)
  const [showIndicators, setShowIndicators] = useState(false)

  // ── Page-level navigation ──
  const startPage = section?.startPage ?? 1
  const endPage = section?.endPage ?? 1
  const totalSectionPages = endPage - startPage + 1

  const [currentPage, setCurrentPage] = useState(startPage)

  // Reset page when section changes, resume from lastPageViewed if available
  useEffect(() => {
    if (section) {
      setCurrentPage(section.lastPageViewed ?? section.startPage)
    }
  }, [section?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const canGoPrev = currentPage > startPage || !!prevSection
  const canGoNext = currentPage < endPage || !!nextSection

  const goToPrevPage = useCallback(() => {
    if (currentPage > startPage) {
      setCurrentPage(p => p - 1)
    } else if (prevSection) {
      router.push(`/book/${bookId}/read/${prevSection.id}`)
    }
  }, [currentPage, startPage, prevSection, bookId, router])

  const goToNextPage = useCallback(() => {
    if (currentPage < endPage) {
      setCurrentPage(p => p + 1)
    } else if (nextSection) {
      router.push(`/book/${bookId}/read/${nextSection.id}`)
    }
  }, [currentPage, endPage, nextSection, bookId, router])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  // Parse section text through .nib pipeline
  // If this is an "Introduction" section, show only intro paragraphs.
  // Otherwise, strip intro paragraphs (they belong to a separate intro section).
  const nibDocument: NibDocument | null = useMemo(() => {
    if (!section?.extractedText || !book) return null
    try {
      const nibService = new NibService()
      const isIntroSection = /introduction$/i.test(section.title.replace(/\s*—\s*/, ' ').trim())

      if (isIntroSection) {
        return nibService.parseExtractedTextIntroOnly(
          section.extractedText,
          book.title,
          book.author,
          section.startPage,
        )
      }

      return nibService.parseExtractedTextBodyOnly(
        section.extractedText,
        book.title,
        book.author,
        section.startPage,
      )
    } catch {
      return null
    }
  }, [section?.extractedText, section?.title, book, section?.startPage])

  const handleMarkedRead = useCallback(() => { refreshReadStatus() }, [refreshReadStatus])

  useAutoTrack(sectionId, section?.isRead ?? false, handleMarkedRead, contentRef)

  const handlePageProgress = useCallback((currentPage: number, totalPages: number, scrollPercent: number) => {
    setSectionProgress(scrollPercent)
    import('@/lib/db/database').then(({ db }) => {
      db.sections.update(sectionId, {
        lastPageViewed: currentPage,
        scrollProgress: scrollPercent,
      })
    })
  }, [sectionId])

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
            <div className="flex-1 overflow-auto">
              {nibDocument ? (
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
