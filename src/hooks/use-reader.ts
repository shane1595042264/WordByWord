'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { toast } from 'sonner'
import type { Book, Chapter, Section } from '@/lib/db/models'

export type ViewMode = 'pdf' | 'text' | 'side-by-side'

export function useReader(bookId: string, sectionId: string) {
  const [book, setBook] = useState<Book | null>(null)
  const [section, setSection] = useState<Section | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [chapterSections, setChapterSections] = useState<Section[]>([])
  const [allBookSections, setAllBookSections] = useState<Section[]>([])
  const [viewMode, setViewModeState] = useState<ViewMode>('side-by-side')
  const [readingMode, setReadingModeState] = useState<'scroll' | 'flip'>('scroll')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const initialLoadDone = useRef(false)
  // Monotonically increasing id per loadData invocation. Rapid section
  // navigation re-runs loadData on the same mounted component; a slower earlier
  // load must not overwrite the newer one. Each invocation captures its id and
  // only commits state while it is still the latest.
  const loadRequestId = useRef(0)

  // Wrap setters to also persist to settings
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      new SettingsService().updateSettings({ defaultViewMode: mode })
    }).catch((err) => {
      toast.error('Failed to save view preference', {
        description: err instanceof Error ? err.message : 'Unknown storage error.',
        duration: 5000,
      })
    })
  }, [])

  const setReadingMode = useCallback((mode: 'scroll' | 'flip') => {
    setReadingModeState(mode)
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      new SettingsService().updateSettings({ readingMode: mode })
    }).catch((err) => {
      toast.error('Failed to save reading mode', {
        description: err instanceof Error ? err.message : 'Unknown storage error.',
        duration: 5000,
      })
    })
  }, [])

  // Full load — only on initial mount or section change
  const loadData = useCallback(async () => {
    const requestId = ++loadRequestId.current
    const isStale = () => requestId !== loadRequestId.current
    setLoading(true)
    setError(null)
    try {
      const { BookRepository, SectionRepository } = await import('@/lib/repositories')
      const { db } = await import('@/lib/db/database')

      const bookRepo = new BookRepository()
      const sectionRepo = new SectionRepository()

      const b = await bookRepo.getById(bookId)
      // Only set viewMode from settings on first load. EPUB books have no PDF
      // representation, so force Text view regardless of the saved default.
      if (!initialLoadDone.current) {
        const { SettingsService } = await import('@/lib/services/settings-service')
        const settingsService = new SettingsService()
        const s = settingsService.getSettings()
        const preferred: ViewMode = b?.format === 'epub' ? 'text' : s.defaultViewMode
        setViewModeState(preferred)
        setReadingModeState(s.readingMode)
        initialLoadDone.current = true
      }
      const s = await db.sections.get(sectionId)
      if (b && s) {
        const ch = await db.chapters.get(s.chapterId)
        const siblings = await sectionRepo.getByChapter(s.chapterId)
        const allSections = await sectionRepo.getByBook(bookId)
        // A newer load has superseded this one — drop its results so the
        // reader never renders a stale section over the current URL/sidebar.
        if (isStale()) return
        setBook(b)
        setSection(s)
        setChapter(ch ?? null)
        setChapterSections(siblings)
        setAllBookSections(allSections)
        await bookRepo.updateLastRead(bookId)
      }
    } catch (err) {
      if (isStale()) return
      console.error('Failed to load reader data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load this section')
    } finally {
      if (!isStale()) setLoading(false)
    }
  }, [bookId, sectionId])

  useEffect(() => {
    loadData()
    // Invalidate any in-flight load when the section changes or the component
    // unmounts, so a slower earlier load can't commit after this effect re-runs.
    return () => { loadRequestId.current++ }
  }, [loadData])

  // Lightweight refresh — just update section read status + sidebar dots
  const refreshReadStatus = useCallback(async () => {
    try {
      const { SectionRepository } = await import('@/lib/repositories')
      const { db } = await import('@/lib/db/database')
      const sectionRepo = new SectionRepository()

      const s = await db.sections.get(sectionId)
      if (s) setSection(s)

      // Update sidebar dots
      if (section?.chapterId) {
        const siblings = await sectionRepo.getByChapter(section.chapterId)
        setChapterSections(siblings)
      }
    } catch (err) {
      console.error('Failed to refresh read status:', err)
    }
  }, [sectionId, section?.chapterId])

  // Chapter-level prev/next (for sidebar navigation within same chapter)
  const currentIndex = chapterSections.findIndex(s => s.id === sectionId)
  const prevChapterSection = currentIndex > 0 ? chapterSections[currentIndex - 1] : null
  const nextChapterSection = currentIndex < chapterSections.length - 1 ? chapterSections[currentIndex + 1] : null

  // Book-level prev/next (crosses chapter boundaries)
  const { prevSection, nextSection } = useMemo(() => {
    const bookIndex = allBookSections.findIndex(s => s.id === sectionId)
    return {
      prevSection: bookIndex > 0 ? allBookSections[bookIndex - 1] : null,
      nextSection: bookIndex < allBookSections.length - 1 ? allBookSections[bookIndex + 1] : null,
    }
  }, [allBookSections, sectionId])

  return {
    book, section, chapter, chapterSections,
    viewMode, setViewMode,
    readingMode, setReadingMode,
    prevSection, nextSection,
    loading, error, refresh: loadData, refreshReadStatus,
  }
}
