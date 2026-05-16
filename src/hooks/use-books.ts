'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Book } from '@/lib/db/models'

export interface BookWithProgress extends Book {
  progress: { read: number; total: number; percentage: number }
}

export function useBooks() {
  const [books, setBooks] = useState<BookWithProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { BookRepository, SectionRepository } = await import('@/lib/repositories')
      const bookRepo = new BookRepository()
      const sectionRepo = new SectionRepository()
      const allBooks = await bookRepo.listAll()
      const withProgress = await Promise.all(
        allBooks.map(async (book) => {
          const progress = await sectionRepo.getBookProgress(book.id)
          return { ...book, progress }
        })
      )
      setBooks(withProgress)
    } catch (err) {
      console.error('Failed to load books:', err)
      setError(err instanceof Error ? err.message : 'Failed to load your library')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Re-fetch books from IndexedDB whenever a cloud sync completes
  useEffect(() => {
    const onSyncComplete = () => { refresh() }
    window.addEventListener('nibble:sync-complete', onSyncComplete)
    return () => window.removeEventListener('nibble:sync-complete', onSyncComplete)
  }, [refresh])

  return { books, loading, error, refresh }
}
