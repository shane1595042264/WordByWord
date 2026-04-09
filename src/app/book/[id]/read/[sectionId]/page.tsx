'use client'

import { use, useCallback, useMemo, useRef, useState, useEffect, type MutableRefObject } from 'react'
import { notFound, useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
  const pdfScrollRef = useRef<HTMLDivElement | null>(null) as MutableRefObject<HTMLDivElement | null>
  const [sectionProgress, setSectionProgress] = useState(0)
  const [showIndicators, setShowIndicators] = useState(false)
  const [syncScroll, setSyncScroll] = useState(true)
  const [showLineNumbers, setShowLineNumbers] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
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

  const [globalKeyOverrides, setGlobalKeyOverrides] = useState<Record<string, string>>({})

  // Load user keymap overrides on mount
  useEffect(() => {
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      const svc = new SettingsService()
      const overrides = svc.getSettings().keymapOverrides ?? {}
      setEffectiveRulebook(getEffectiveRulebook(overrides))
      setGlobalKeyOverrides(overrides)
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

  // ── PDF mode: Vim-style scroll keybindings (Ctrl+E, Ctrl+Y, d, u, gg, G) ──
  const lastPdfGTime = useRef(0)
  useEffect(() => {
    if (viewMode !== 'pdf') return
    const LINE_HEIGHT = 24
    const GG_TIMEOUT = 500

    const handlePdfKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      const el = pdfScrollRef.current
      if (!el) return

      // Ctrl+E — scroll down one line
      if (e.ctrlKey && e.key === 'e') {
        e.preventDefault()
        el.scrollBy({ top: LINE_HEIGHT, behavior: 'smooth' })
        return
      }
      // Ctrl+Y — scroll up one line
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault()
        el.scrollBy({ top: -LINE_HEIGHT, behavior: 'smooth' })
        return
      }

      // Block other Ctrl/Meta/Alt combos
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // j — scroll down one line
      if (e.key === 'j') {
        e.preventDefault()
        el.scrollBy({ top: LINE_HEIGHT, behavior: 'smooth' })
        return
      }
      // k — scroll up one line
      if (e.key === 'k') {
        e.preventDefault()
        el.scrollBy({ top: -LINE_HEIGHT, behavior: 'smooth' })
        return
      }

      // d — half-page down
      if (e.key === 'd') {
        e.preventDefault()
        el.scrollBy({ top: el.clientHeight * 0.5, behavior: 'smooth' })
        return
      }
      // u — half-page up
      if (e.key === 'u') {
        e.preventDefault()
        el.scrollBy({ top: -el.clientHeight * 0.5, behavior: 'smooth' })
        return
      }
      // G — scroll to bottom
      if (e.key === 'G' && e.shiftKey) {
        e.preventDefault()
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        return
      }
      // gg — scroll to top (double-tap g)
      if (e.key === 'g' && !e.shiftKey) {
        const now = Date.now()
        if (now - lastPdfGTime.current < GG_TIMEOUT) {
          e.preventDefault()
          el.scrollTo({ top: 0, behavior: 'smooth' })
          lastPdfGTime.current = 0
          return
        }
        lastPdfGTime.current = now
        e.preventDefault()
        return
      }
    }
    window.addEventListener('keydown', handlePdfKey)
    return () => window.removeEventListener('keydown', handlePdfKey)
  }, [viewMode])

  // Select first visible word when entering text/side-by-side mode (normal mode = word cursor)
  // On first load, restore to saved word index if available from Continue Reading params,
  // or fall back to section-level saved scroll progress (for direct section navigation)
  useEffect(() => {
    if (viewMode === 'text' || viewMode === 'side-by-side') {
      const t = setTimeout(() => {
        const restore = restoreRef.current
        if (restore && !restore.applied && restore.wordIndex != null) {
          // Restore to exact word position (Continue Reading)
          nibTextViewerRef.current?.selectWordByIndex(restore.wordIndex)
          restore.applied = true
        } else if (restore && !restore.applied && restore.scrollProgress != null) {
          // Restore scroll position from Continue Reading params
          const el = textScrollRef.current
          if (el) {
            const maxScroll = el.scrollHeight - el.clientHeight
            el.scrollTop = (restore.scrollProgress / 100) * maxScroll
          }
          nibTextViewerRef.current?.selectWordByDelta(0)
          restore.applied = true
        } else if (section?.scrollProgress != null && section.scrollProgress > 0) {
          // Restore from section-level saved position (returning to section directly)
          const el = textScrollRef.current
          if (el) {
            const maxScroll = el.scrollHeight - el.clientHeight
            if (maxScroll > 0) {
              el.scrollTop = (section.scrollProgress / 100) * maxScroll
            }
          }
          nibTextViewerRef.current?.selectWordByDelta(0)
        } else {
          nibTextViewerRef.current?.selectWordByDelta(0)
        }
      }, 300) // Slightly longer delay for content to render
      return () => clearTimeout(t)
    }
  }, [viewMode, section?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Clamp lastPageViewed to valid bounds to prevent stale/corrupt values
      // from leaving currentPage beyond navEndPage (which disables the Next button)
      const saved = section.lastPageViewed
      const validPage = saved != null
        ? Math.max(section.startPage, Math.min(saved, section.endPage))
        : section.startPage
      setCurrentPage(validPage)
      setSectionProgress(section.scrollProgress ?? 0)
    }
  }, [section?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  // Restore PDF scroll position when returning to a section directly
  // (not via Continue Reading which uses URL params handled in text mode)
  useEffect(() => {
    if (viewMode !== 'pdf' || !section) return

    const restore = restoreRef.current
    // Skip if Continue Reading scroll param exists (handled via currentPage already)
    if (restore && !restore.applied && restore.scrollProgress != null) return

    const savedProgress = section.scrollProgress
    if (savedProgress == null || savedProgress <= 0) return

    // Wait for PDF pages to render before scrolling
    const timer = setTimeout(() => {
      const el = pdfScrollRef.current
      if (el && el.scrollHeight > el.clientHeight) {
        const maxScroll = el.scrollHeight - el.clientHeight
        el.scrollTop = (savedProgress / 100) * maxScroll
      }
    }, 800)

    return () => clearTimeout(timer)
  }, [section?.id, viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

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
  // In PDF-only mode, don't count overlap pages — each section shows unique pages only
  const pdfOnlyTotalPages = endPage - startPage + 1

  // In text mode, all section text is shown at once — no page-level navigation.
  // Prev/Next should jump directly to prev/next section.
  const isTextMode = viewMode === 'text'
  // In side-by-side mode the PDF renders up to effectiveEndPage, so navigation
  // must match — otherwise the toolbar shows more pages than the user can reach.
  const navEndPage = viewMode === 'side-by-side' ? effectiveEndPage : endPage
  const canGoPrev = isTextMode ? !!prevSection : (currentPage > startPage || !!prevSection)
  const canGoNext = isTextMode ? !!nextSection : (currentPage < navEndPage || !!nextSection)

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
    if (currentPage < navEndPage) {
      setCurrentPage(p => p + 1)
    } else if (nextSection) {
      router.push(`/book/${bookId}/read/${nextSection.id}`)
    }
  }, [isTextMode, currentPage, navEndPage, nextSection, bookId, router])

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page)
  }, [])

  // Use richContent (Mathpix Markdown) as fallback when extractedText is null
  const sectionText = section?.extractedText || section?.richContent || null

  useEffect(() => {
    if (!book || !section) { setNibDocument(null); return }
    if (!sectionText && !section.richContent) { setNibDocument(null); return }

    let cancelled = false
    const isIntroSection = /introduction$/i.test(section.title.replace(/\s*—\s*/, ' ').trim())

    // Priority 1: richContent (Mathpix Markdown) — synchronous, no flash
    if (section.richContent) {
      ;(async () => {
        const { NibMarkdownParser } = await import('@/lib/nib/markdown-parser')
        const mdParser = new NibMarkdownParser()
        const docData = mdParser.parse(section.richContent!, book.title, book.author)
        const { NibDocument: NibDoc } = await import('@/lib/nib')
        const doc = NibDoc.fromData(docData)
        if (!cancelled) setNibDocument(doc)
      })()
      return () => { cancelled = true }
    }

    // Priority 2: rich PDF parsing (preserves bold/italic font info)
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
                sectionText!,
                book.title,
                book.author,
                section.startPage,
              ))
            } else {
              setNibDocument(fallbackService.parseExtractedTextBodyOnly(
                sectionText!,
                book.title,
                book.author,
                section.startPage,
                section.title,
              ))
            }
          } catch (err) { console.error('Nib text fallback parsing failed:', err); setNibDocument(null) }
        }
      })
    } else if (sectionText) {
      // Priority 3: Text-based parsing (when no PDF blob)
      try {
        const nibService = new NibService()
        if (isIntroSection) {
          setNibDocument(nibService.parseExtractedTextIntroOnly(
            sectionText,
            book.title,
            book.author,
            section.startPage,
          ))
        } else {
          setNibDocument(nibService.parseExtractedTextBodyOnly(
            sectionText,
            book.title,
            book.author,
            section.startPage,
            section.title,
          ))
        }
      } catch (err) { console.error('Nib text parsing failed:', err); setNibDocument(null) }
    } else {
      setNibDocument(null)
    }

    return () => { cancelled = true }
  }, [sectionText, section?.richContent, section?.title, book, section?.startPage, section?.endPage, nextSection?.title, nextSection?.startPage]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkedRead = useCallback(() => { refreshReadStatus() }, [refreshReadStatus])

  // Only track after loading completes to ensure scroll containers are mounted
  useAutoTrack(sectionId, loading ? true : (section?.isRead ?? false), handleMarkedRead, contentRef, textScrollRef, viewMode, pdfScrollRef)

  const handlePageProgress = useCallback((currentPage: number, totalPages: number, scrollPercent: number) => {
    setSectionProgress(scrollPercent)
    import('@/lib/db/database').then(({ db }) => {
      const now = Date.now()
      db.sections.update(sectionId, {
        lastPageViewed: currentPage,
        scrollProgress: scrollPercent,
        updatedAt: now,
      }).catch((err) => {
        console.error('Failed to save page progress:', err)
        if (!saveErrorShownRef.current) {
          saveErrorShownRef.current = true
          toast.warning('Could not save reading position. Your progress may not be preserved.')
        }
      })
      import('@/lib/services/sync-service').then(({ syncService }) => syncService.markDirty())
    })
  }, [sectionId])

  // ── Text mode scroll tracking (debounced DB writes) ──
  const scrollDbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveErrorShownRef = useRef(false)
  const handleTextScroll = useCallback(() => {
    const el = textScrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const maxScroll = scrollHeight - clientHeight
    const percent = maxScroll <= 0 ? 100 : Math.min(100, Math.round((scrollTop / maxScroll) * 100))
    setSectionProgress(percent)
    // Debounce the DB write to avoid hundreds of writes per second
    if (scrollDbTimerRef.current) clearTimeout(scrollDbTimerRef.current)
    scrollDbTimerRef.current = setTimeout(() => {
      import('@/lib/db/database').then(({ db }) => {
        const now = Date.now()
        db.sections.update(sectionId, { scrollProgress: percent, updatedAt: now }).catch((err) => {
          console.error('Failed to save scroll progress:', err)
          if (!saveErrorShownRef.current) {
            saveErrorShownRef.current = true
            toast.warning('Could not save reading position. Your progress may not be preserved.')
          }
        })
        import('@/lib/services/sync-service').then(({ syncService }) => syncService.markDirty())
      })
    }, 500)
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
    // Delay longer than scroll restore (300ms) to avoid overwriting restored position
    const timer = setTimeout(() => handleTextScroll(), 600)
    return () => clearTimeout(timer)
  }, [viewMode, textScrollReady]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ──
  useShortcut('toggle-indicators', 'Toggle Element Labels', globalKeyOverrides['toggle-indicators'] || 'Ctrl+i', useCallback(() => {
    setShowIndicators(prev => !prev)
  }, []))

  useShortcut('view-pdf', 'PDF View', globalKeyOverrides['view-pdf'] || 'Ctrl+1', useCallback(() => {
    setViewMode('pdf')
  }, [setViewMode]))

  useShortcut('view-text', 'Text View', globalKeyOverrides['view-text'] || 'Ctrl+2', useCallback(() => {
    setViewMode('text')
  }, [setViewMode]))

  useShortcut('view-side-by-side', 'Side-by-Side View', globalKeyOverrides['view-side-by-side'] || 'Ctrl+3', useCallback(() => {
    setViewMode('side-by-side')
  }, [setViewMode]))

  useShortcut('toggle-line-numbers', 'Toggle Line Numbers', globalKeyOverrides['toggle-line-numbers'] || 'Ctrl+Shift+l', useCallback(() => {
    setShowLineNumbers(prev => !prev)
  }, []))

  useShortcut('toggle-sidebar', 'Toggle Sidebar', globalKeyOverrides['toggle-sidebar'] || 'Ctrl+[', useCallback(() => {
    setSidebarCollapsed(prev => !prev)
  }, []))

  useShortcut('prev-page', 'Previous Page', globalKeyOverrides['prev-page'] || 'Ctrl+ArrowLeft', goToPrevPage)
  useShortcut('next-page', 'Next Page', globalKeyOverrides['next-page'] || 'Ctrl+ArrowRight', goToNextPage)

  // Persist currentPage to DB
  useEffect(() => {
    if (!section) return
    import('@/lib/db/database').then(({ db }) => {
      const now = Date.now()
      db.sections.update(sectionId, { lastPageViewed: currentPage, updatedAt: now }).catch((err) => {
        console.error('Failed to save current page:', err)
        if (!saveErrorShownRef.current) {
          saveErrorShownRef.current = true
          toast.warning('Could not save reading position. Your progress may not be preserved.')
        }
      })
      import('@/lib/services/sync-service').then(({ syncService }) => syncService.markDirty())
    })
  }, [currentPage, sectionId, section])

  if (loading) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  if (!book || !section) {
    notFound()
  }

  return (
    <div className="flex flex-col h-screen">
      <ReaderToolbar
        bookId={bookId}
        bookTitle={book?.title}
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
        totalSectionPages={viewMode === 'pdf' ? pdfOnlyTotalPages : totalSectionPages}
        startPage={startPage}
        onPrevPage={goToPrevPage}
        onNextPage={goToNextPage}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        showLineNumbers={showLineNumbers}
        onLineNumbersToggle={() => setShowLineNumbers(prev => !prev)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
      />
      <div className="flex flex-1 overflow-hidden">
        <SectionSidebar
          bookId={bookId}
          sections={chapterSections}
          currentSectionId={sectionId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
        />
        <div className="flex-1 overflow-hidden flex flex-col" ref={contentRef}>
          {viewMode === 'pdf' && (
            <PDFViewer
              pdfBlob={book.pdfBlob}
              startPage={section.startPage}
              endPage={endPage}
              readingMode={readingMode}
              currentPage={currentPage}
              onPageChange={handlePageChange}
              onPageProgress={handlePageProgress}
              scrollRef={pdfScrollRef}
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
                {/^(table of )?contents$/i.test(section.title) && sectionText ? (
                  <TocViewer
                    bookId={bookId}
                    extractedText={sectionText}
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
                  <TextViewer text={sectionText} sectionTitle={section.title} />
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
                  text={sectionText}
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
