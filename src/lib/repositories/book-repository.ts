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
      completedAt: null,
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

  async markComplete(id: string): Promise<void> {
    await db.books.update(id, { completedAt: Date.now(), updatedAt: Date.now() })
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
  ): Promise<{ backendSyncFailed: boolean }> {
    // Update local Dexie DB immediately
    const update: Partial<Book> = { updatedAt: Date.now() }
    if (data.title !== undefined) update.title = data.title
    if (data.author !== undefined) update.author = data.author
    if (data.coverImage !== undefined) update.coverImage = data.coverImage
    await db.books.update(id, update)
    syncService.markDirty()

    // title is deliberately NOT pushed here: /books/:id/metadata writes the SHARED
    // book_catalog row, so sending a personal rename renamed the book for every other
    // user holding the same file_hash, and rewrote the Marketplace listing + the fuzzy
    // upload dedup. The per-user home for a rename is books.custom_title, which the
    // local write + markDirty() above already carry through /sync via bookToSync.
    // Catalog titles stay admin-only (PUT /admin/catalog/:id).
    const backendData: Record<string, unknown> = {}
    if (data.author !== undefined) backendData.author = data.author
    if (data.coverImage !== undefined) backendData.coverUrl = data.coverImage
    if (Object.keys(backendData).length === 0) return { backendSyncFailed: false }

    // Fetch remoteId after local update; skip backend push if book hasn't been
    // synced to the catalog yet — markDirty above will let the next global sync pick it up.
    const book = await db.books.get(id)
    if (!book?.remoteId) return { backendSyncFailed: false }

    // Sync to backend
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return { backendSyncFailed: true }
      const { token } = await tokenRes.json()

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const res = await fetch(`${apiUrl}/books/${book.remoteId}/metadata`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(backendData),
      })
      if (!res.ok) {
        console.warn(`Failed to sync book metadata to backend: ${res.status}`)
        return { backendSyncFailed: true }
      }
      return { backendSyncFailed: false }
    } catch {
      // Backend sync failed — local update still succeeded (offline-first)
      console.warn('Failed to sync book metadata to backend')
      return { backendSyncFailed: true }
    }
  }

  async delete(id: string): Promise<{ backendSyncFailed: boolean }> {
    // Get remoteId before deleting locally
    const book = await db.books.get(id)
    const remoteId = book?.remoteId

    await db.transaction('rw', [db.books, db.chapters, db.sections, db.vocabulary], async () => {
      await db.sections.where('bookId').equals(id).delete()
      await db.chapters.where('bookId').equals(id).delete()
      await db.vocabulary.where('bookId').equals(id).delete()
      await db.books.delete(id)
    })

    // Local-only book never reached the backend — nothing to delete remotely.
    if (!remoteId) return { backendSyncFailed: false }

    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) {
        console.warn(`Failed to delete book from backend: auth token fetch returned ${tokenRes.status}`)
        return { backendSyncFailed: true }
      }
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
      const res = await fetch(`${apiUrl}/books/${remoteId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      // 404 = already gone on server (parity with KAN-137 vocab delete)
      if (!res.ok && res.status !== 404) {
        console.warn(`Failed to delete book from backend: ${res.status}`)
        return { backendSyncFailed: true }
      }
      return { backendSyncFailed: false }
    } catch {
      console.warn('Failed to delete book from backend')
      return { backendSyncFailed: true }
    }
  }
}
