'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Book, Chapter, Section } from '@/lib/db/models'
import { reportLazyImportError } from '@/lib/lazy-import-error'

export interface ChapterWithSections extends Chapter {
  sections: Section[]
  progress: { read: number; total: number; percentage: number }
}

export interface BookDetail extends Book {
  chapters: ChapterWithSections[]
  progress: { read: number; total: number; percentage: number }
  allSections: Section[]
}

export function useBookDetail(bookId: string) {
  const [book, setBook] = useState<BookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    // Background refreshes (e.g. sync-complete) pass silent:true so the
    // already-rendered dashboard updates in place instead of blanking to Loading...
    if (!opts?.silent) setLoading(true)
    setError(null)
    try {
      const { BookRepository, ChapterRepository, SectionRepository } = await import('@/lib/repositories')
      const bookRepo = new BookRepository()
      const chapterRepo = new ChapterRepository()
      const sectionRepo = new SectionRepository()

      const b = await bookRepo.getById(bookId)
      if (!b) { setBook(null); return }

      const chapters = await chapterRepo.getByBook(bookId)
      const allSections = await sectionRepo.getByBook(bookId)
      const bookProgress = await sectionRepo.getBookProgress(bookId)

      const chaptersWithSections: ChapterWithSections[] = await Promise.all(
        chapters.map(async (ch) => {
          const sections = await sectionRepo.getByChapter(ch.id)
          const progress = await sectionRepo.getChapterProgress(ch.id)
          return { ...ch, sections, progress }
        })
      )

      setBook({ ...b, chapters: chaptersWithSections, progress: bookProgress, allSections })
    } catch (err) {
      // Surfaces a stale-chunk reload prompt after a deploy; always logs.
      reportLazyImportError('useBookDetail load', err)
      setError(err instanceof Error ? err.message : 'Failed to load this book')
    } finally {
      setLoading(false)
    }
  }, [bookId])

  useEffect(() => { refresh() }, [refresh])

  // Refresh when sync completes (e.g. scrollProgress synced from server)
  useEffect(() => {
    const onSyncComplete = () => refresh({ silent: true })
    window.addEventListener('nibble:sync-complete', onSyncComplete)
    return () => window.removeEventListener('nibble:sync-complete', onSyncComplete)
  }, [refresh])

  return { book, loading, error, refresh }
}
