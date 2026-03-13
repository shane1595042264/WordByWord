import { describe, it, expect, beforeEach } from 'vitest'
import { BookRepository } from '../book-repository'
import { db } from '@/lib/db/database'

describe('BookRepository', () => {
  const repo = new BookRepository()

  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('should create a book and return it', async () => {
    const book = await repo.create({
      title: 'Test Book',
      author: 'Author',
      totalPages: 100,
      pdfBlob: new Blob(['test']),
    })
    expect(book.id).toBeDefined()
    expect(book.structureSource).toBe('native')
    expect(book.processingStatus).toBe('pending')
  })

  it('should list all books sorted by lastReadAt desc', async () => {
    await repo.create({ title: 'Old', author: 'A', totalPages: 10, pdfBlob: new Blob(['a']) })
    const newer = await repo.create({ title: 'New', author: 'B', totalPages: 20, pdfBlob: new Blob(['b']) })
    await repo.updateLastRead(newer.id)
    const books = await repo.listAll()
    expect(books[0].title).toBe('New')
  })

  it('should delete a book and its chapters/sections', async () => {
    const book = await repo.create({ title: 'Del', author: 'A', totalPages: 10, pdfBlob: new Blob(['a']) })
    await db.chapters.add({ id: 'ch1', bookId: book.id, title: 'Ch', order: 1, startPage: 1, endPage: 10, updatedAt: Date.now() })
    await db.sections.add({ id: 's1', chapterId: 'ch1', bookId: book.id, title: 'S', order: 1, startPage: 1, endPage: 5, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() })
    await repo.delete(book.id)
    expect(await db.books.get(book.id)).toBeUndefined()
    expect(await db.chapters.where('bookId').equals(book.id).count()).toBe(0)
    expect(await db.sections.where('bookId').equals(book.id).count()).toBe(0)
  })
})
