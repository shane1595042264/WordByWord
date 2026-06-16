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

  it('should delete vocabulary belonging to the deleted book and leave unrelated vocab alone', async () => {
    const book = await repo.create({ title: 'Vocab Book', author: 'A', totalPages: 10, pdfBlob: new Blob(['a']) })
    const otherBook = await repo.create({ title: 'Other Book', author: 'B', totalPages: 10, pdfBlob: new Blob(['b']) })
    const now = Date.now()
    await db.vocabulary.bulkAdd([
      { id: 'v1', word: 'foo', pronunciation: '', translation: 't', targetLanguage: 'en', contextSentence: '', explanation: null, bookTitle: 'Vocab Book', sectionTitle: '', pageNumber: 1, bookId: book.id, reviewCount: 0, lastReviewedAt: null, createdAt: now, updatedAt: now },
      { id: 'v2', word: 'bar', pronunciation: '', translation: 't', targetLanguage: 'en', contextSentence: '', explanation: null, bookTitle: 'Vocab Book', sectionTitle: '', pageNumber: 2, bookId: book.id, reviewCount: 0, lastReviewedAt: null, createdAt: now, updatedAt: now },
      { id: 'v3', word: 'baz', pronunciation: '', translation: 't', targetLanguage: 'en', contextSentence: '', explanation: null, bookTitle: 'Other Book', sectionTitle: '', pageNumber: 1, bookId: otherBook.id, reviewCount: 0, lastReviewedAt: null, createdAt: now, updatedAt: now },
    ])
    await repo.delete(book.id)
    expect(await db.vocabulary.where('bookId').equals(book.id).count()).toBe(0)
    expect(await db.vocabulary.where('bookId').equals(otherBook.id).count()).toBe(1)
    expect((await db.vocabulary.get('v3'))?.word).toBe('baz')
  })
})
