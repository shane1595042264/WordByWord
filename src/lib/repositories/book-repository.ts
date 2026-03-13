import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'
import { syncService } from '../services/sync-service'

interface CreateBookInput {
  title: string
  author: string
  totalPages: number
  pdfBlob: Blob
  coverImage?: string | null
}

export class BookRepository {
  async create(input: CreateBookInput): Promise<Book> {
    const book: Book = {
      id: uuid(),
      title: input.title,
      author: input.author,
      totalPages: input.totalPages,
      pdfBlob: input.pdfBlob,
      coverImage: input.coverImage ?? null,
      structureSource: 'native',
      processingStatus: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
    }
    await db.books.add(book)
    syncService.markDirty()
    return book
  }

  async getById(id: string): Promise<Book | undefined> {
    return db.books.get(id)
  }

  async listAll(): Promise<Book[]> {
    return db.books.orderBy('createdAt').reverse().toArray()
  }

  async updateLastRead(id: string): Promise<void> {
    await db.books.update(id, { lastReadAt: Date.now(), updatedAt: Date.now() })
    syncService.markDirty()
  }

  /** Save last-accessed section + reading position for Continue Reading */
  async updateLastAccessed(
    bookId: string,
    sectionId: string,
    scrollProgress: number,
    wordIndex: number | null,
  ): Promise<void> {
    await db.books.update(bookId, {
      lastAccessedSectionId: sectionId,
      lastAccessedScrollProgress: scrollProgress,
      lastAccessedWordIndex: wordIndex,
      lastReadAt: Date.now(),
      updatedAt: Date.now(),
    })
    syncService.markDirty()
  }

  async updateProcessingStatus(id: string, status: Book['processingStatus']): Promise<void> {
    await db.books.update(id, { processingStatus: status, updatedAt: Date.now() })
    syncService.markDirty()
  }

  /** Update book metadata (title, author, cover, etc.) — local + backend sync */
  async updateDetails(
    id: string,
    data: { title?: string; author?: string; coverImage?: string | null },
  ): Promise<void> {
    // Update local Dexie DB immediately
    const update: Partial<Book> = { updatedAt: Date.now() }
    if (data.title !== undefined) update.title = data.title
    if (data.author !== undefined) update.author = data.author
    if (data.coverImage !== undefined) update.coverImage = data.coverImage
    await db.books.update(id, update)
    syncService.markDirty()

    // Sync to backend
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const backendData: Record<string, unknown> = {}
      if (data.title !== undefined) backendData.title = data.title
      if (data.author !== undefined) backendData.author = data.author
      if (data.coverImage !== undefined) backendData.coverUrl = data.coverImage

      await fetch(`${apiUrl}/books/${id}/metadata`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(backendData),
      })
    } catch {
      // Backend sync failed — local update still succeeded (offline-first)
      console.warn('Failed to sync book metadata to backend')
    }
  }

  async delete(id: string): Promise<void> {
    await db.transaction('rw', [db.books, db.chapters, db.sections], async () => {
      await db.sections.where('bookId').equals(id).delete()
      await db.chapters.where('bookId').equals(id).delete()
      await db.books.delete(id)
    })
  }
}
