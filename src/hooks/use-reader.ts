'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Book, Chapter, Section } from '@/lib/db/models'

export type ViewMode = 'pdf' | 'text' | 'side-by-side'

export function useReader(bookId: string, sectionId: string) {
  const [book, setBook] = useState<Book | null>(null)
  const [section, setSection] = useState<Section | null>(null)
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [chapterSections, setChapterSections] = useState<Section[]>([])
  const [viewMode, setViewModeState] = useState<ViewMode>('side-by-side')
  const [readingMode, setReadingModeState] = useState<'scroll' | 'flip'>('scroll')
  const [loading, setLoading] = useState(true)
  const initialLoadDone = useRef(false)

  // Wrap setters to also persist to settings
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode)
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      new SettingsService().updateSettings({ defaultViewMode: mode })
    })
  }, [])

  const setReadingMode = useCallback((mode: 'scroll' | 'flip') => {
    setReadingModeState(mode)
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      new SettingsService().updateSettings({ readingMode: mode })
    })
  }, [])

  // Full load — only on initial mount or section change
  const loadData = useCallback(async () => {
    setLoading(true)
    const { BookRepository, SectionRepository } = await import('@/lib/repositories')
    const { db } = await import('@/lib/db/database')

    const bookRepo = new BookRepository()
    const sectionRepo = new SectionRepository()

    // Only set viewMode from settings on first load
    if (!initialLoadDone.current) {
      const { SettingsService } = await import('@/lib/services/settings-service')
      const settingsService = new SettingsService()
      const s = settingsService.getSettings()
      setViewModeState(s.defaultViewMode)
      setReadingModeState(s.readingMode)
      initialLoadDone.current = true
    }

    const b = await bookRepo.getById(bookId)
    const s = await db.sections.get(sectionId)
    if (b && s) {
      const ch = await db.chapters.get(s.chapterId)
      const siblings = await sectionRepo.getByChapter(s.chapterId)
      setBook(b)
      setSection(s)
      setChapter(ch ?? null)
      setChapterSections(siblings)
      await bookRepo.updateLastRead(bookId)
    }
    setLoading(false)
  }, [bookId, sectionId])

  useEffect(() => { loadData() }, [loadData])

  // Lightweight refresh — just update section read status + sidebar dots
  const refreshReadStatus = useCallback(async () => {
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
  }, [sectionId, section?.chapterId])

  const currentIndex = chapterSections.findIndex(s => s.id === sectionId)
  const prevSection = currentIndex > 0 ? chapterSections[currentIndex - 1] : null
  const nextSection = currentIndex < chapterSections.length - 1 ? chapterSections[currentIndex + 1] : null

  return {
    book, section, chapter, chapterSections,
    viewMode, setViewMode,
    readingMode, setReadingMode,
    prevSection, nextSection,
    loading, refresh: loadData, refreshReadStatus,
  }
}
