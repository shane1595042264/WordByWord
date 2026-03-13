import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../database'
import { v4 as uuid } from 'uuid'

describe('Database', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('should store and retrieve a book', async () => {
    const book = {
      id: uuid(),
      title: 'Test Book',
      author: 'Author',
      totalPages: 100,
      pdfBlob: new Blob(['test'], { type: 'application/pdf' }),
      coverImage: null,
      structureSource: 'native' as const,
      processingStatus: 'pending' as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
    }
    await db.books.add(book)
    const retrieved = await db.books.get(book.id)
    expect(retrieved?.title).toBe('Test Book')
  })

  it('should store chapters linked to a book', async () => {
    const bookId = uuid()
    const chapter = {
      id: uuid(),
      bookId,
      title: 'Chapter 1',
      order: 1,
      startPage: 1,
      endPage: 20,
      updatedAt: Date.now(),
    }
    await db.chapters.add(chapter)
    const chapters = await db.chapters.where('bookId').equals(bookId).toArray()
    expect(chapters).toHaveLength(1)
    expect(chapters[0].title).toBe('Chapter 1')
  })

  it('should store sections linked to a chapter', async () => {
    const bookId = uuid()
    const chapterId = uuid()
    const section = {
      id: uuid(),
      chapterId,
      bookId,
      title: 'Section 1.1',
      order: 1,
      startPage: 1,
      endPage: 5,
      extractedText: null,
      isRead: false,
      readAt: null,
      lastPageViewed: null,
      scrollProgress: null,
      updatedAt: Date.now(),
    }
    await db.sections.add(section)
    const sections = await db.sections.where('chapterId').equals(chapterId).toArray()
    expect(sections).toHaveLength(1)
    expect(sections[0].isRead).toBe(false)
  })
})
