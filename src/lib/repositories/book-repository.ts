import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'

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
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
    }
    await db.books.add(book)
    return book
  }

  async getById(id: string): Promise<Book | undefined> {
    return db.books.get(id)
  }

  async listAll(): Promise<Book[]> {
    return db.books.orderBy('createdAt').reverse().toArray()
  }

  async updateLastRead(id: string): Promise<void> {
    await db.books.update(id, { lastReadAt: Date.now() })
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
    })
  }

  async updateProcessingStatus(id: string, status: Book['processingStatus']): Promise<void> {
    await db.books.update(id, { processingStatus: status })
  }

  async delete(id: string): Promise<void> {
    await db.transaction('rw', [db.books, db.chapters, db.sections], async () => {
      await db.sections.where('bookId').equals(id).delete()
      await db.chapters.where('bookId').equals(id).delete()
      await db.books.delete(id)
    })
  }
}
