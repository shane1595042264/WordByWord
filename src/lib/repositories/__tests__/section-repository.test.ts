import { describe, it, expect, beforeEach } from 'vitest'
import { SectionRepository } from '../section-repository'
import { db } from '@/lib/db/database'
import type { Book, Section } from '@/lib/db/models'

describe('SectionRepository', () => {
  const repo = new SectionRepository()

  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('should mark a section as read', async () => {
    const section: Section = {
      id: 's1', chapterId: 'ch1', bookId: 'b1', title: 'S1',
      order: 1, startPage: 1, endPage: 5, extractedText: null,
      isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null,
      updatedAt: Date.now(),
    }
    await db.sections.add(section)
    await repo.markAsRead('s1')
    const updated = await db.sections.get('s1')
    expect(updated?.isRead).toBe(true)
    expect(updated?.readAt).toBeDefined()
  })

  it('should calculate progress for a book', async () => {
    const sections: Section[] = [
      { id: 's1', chapterId: 'ch1', bookId: 'b1', title: 'S1', order: 1, startPage: 1, endPage: 5, extractedText: null, isRead: true, readAt: Date.now(), lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
      { id: 's2', chapterId: 'ch1', bookId: 'b1', title: 'S2', order: 2, startPage: 5, endPage: 10, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
    ]
    await db.sections.bulkAdd(sections)
    const progress = await repo.getBookProgress('b1')
    expect(progress.read).toBe(1)
    expect(progress.total).toBe(2)
    expect(progress.percentage).toBe(50)
  })

  it('should get sections by chapter ordered', async () => {
    await db.sections.bulkAdd([
      { id: 's2', chapterId: 'ch1', bookId: 'b1', title: 'Second', order: 2, startPage: 5, endPage: 10, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
      { id: 's1', chapterId: 'ch1', bookId: 'b1', title: 'First', order: 1, startPage: 1, endPage: 5, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
    ])
    const sections = await repo.getByChapter('ch1')
    expect(sections[0].title).toBe('First')
    expect(sections[1].title).toBe('Second')
  })

  it('should serialize concurrent markAsRead on the last two unread sections — only one returns true and completedAt is written exactly once', async () => {
    const bookId = 'b-race'
    const book: Book = {
      id: bookId,
      title: 'Race Test',
      author: 'A',
      totalPages: 10,
      pdfBlob: new Blob(['x']),
      coverImage: null,
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

    const sections: Section[] = [
      { id: 's1', chapterId: 'ch1', bookId, title: 'S1', order: 1, startPage: 1, endPage: 5, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
      { id: 's2', chapterId: 'ch1', bookId, title: 'S2', order: 2, startPage: 5, endPage: 10, extractedText: null, isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: Date.now() },
    ]
    await db.sections.bulkAdd(sections)

    const [r1, r2] = await Promise.all([repo.markAsRead('s1'), repo.markAsRead('s2')])

    expect([r1, r2].filter(v => v === true)).toHaveLength(1)
    expect([r1, r2].filter(v => v === false)).toHaveLength(1)

    const stored = await db.books.get(bookId)
    expect(typeof stored?.completedAt).toBe('number')

    const both = await db.sections.where('bookId').equals(bookId).toArray()
    expect(both.every(s => s.isRead)).toBe(true)
  })

  /** Seed a book with `count` unread sections. */
  const seedBook = async (bookId: string, count: number): Promise<void> => {
    const book: Book = {
      id: bookId,
      title: 'Unmark Test',
      author: 'A',
      totalPages: 10,
      pdfBlob: new Blob(['x']),
      coverImage: null,
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
    await db.sections.bulkAdd(
      Array.from({ length: count }, (_, i) => ({
        id: `${bookId}-s${i + 1}`, chapterId: 'ch1', bookId, title: `S${i + 1}`,
        order: i + 1, startPage: i * 5 + 1, endPage: (i + 1) * 5, extractedText: null,
        isRead: false, readAt: null, lastPageViewed: null, scrollProgress: null,
        updatedAt: Date.now(),
      }))
    )
  }

  it('should clear book.completedAt when a section of a completed book is un-marked', async () => {
    const bookId = 'b-unmark'
    await seedBook(bookId, 2)
    const beforeUpdatedAt = (await db.books.get(bookId))!.updatedAt

    expect(await repo.markAsRead(`${bookId}-s1`)).toBe(false)
    expect(await repo.markAsRead(`${bookId}-s2`)).toBe(true)
    expect(typeof (await db.books.get(bookId))?.completedAt).toBe('number')

    await repo.markAsUnread(`${bookId}-s2`)

    const after = await db.books.get(bookId)
    expect(after?.completedAt).toBeNull()
    expect(after!.updatedAt).toBeGreaterThanOrEqual(beforeUpdatedAt)
    expect((await db.sections.get(`${bookId}-s2`))?.isRead).toBe(false)
  })

  it('should let the completion celebration fire again after an un-mark (markAsRead returns true)', async () => {
    const bookId = 'b-recelebrate'
    await seedBook(bookId, 2)

    await repo.markAsRead(`${bookId}-s1`)
    expect(await repo.markAsRead(`${bookId}-s2`)).toBe(true)

    await repo.markAsUnread(`${bookId}-s2`)

    // Before the fix this returned false: the stale completedAt tripped the guard.
    expect(await repo.markAsRead(`${bookId}-s2`)).toBe(true)
    expect(typeof (await db.books.get(bookId))?.completedAt).toBe('number')
  })

  it('should be a no-op on the book when un-marking a section of a never-completed book', async () => {
    const bookId = 'b-never-complete'
    await seedBook(bookId, 2)

    await repo.markAsRead(`${bookId}-s1`)
    expect((await db.books.get(bookId))?.completedAt).toBeNull()

    await expect(repo.markAsUnread(`${bookId}-s1`)).resolves.toBeUndefined()

    expect((await db.books.get(bookId))?.completedAt).toBeNull()
    expect((await db.sections.get(`${bookId}-s1`))?.isRead).toBe(false)
  })

  it('should not throw when un-marking a section id that does not exist', async () => {
    await expect(repo.markAsUnread('missing-section')).resolves.toBeUndefined()
  })
})
