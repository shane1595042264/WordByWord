import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SectionRepository, computeSectionProgress } from '../section-repository'
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

  it('should compute the same progress in memory as the per-chapter/per-book queries (KAN-324)', async () => {
    const mk = (id: string, chapterId: string, order: number, isRead: boolean, scrollProgress: number | null): Section => ({
      id, chapterId, bookId: 'b-equiv', title: id, order, startPage: order, endPage: order + 1,
      extractedText: null, isRead, readAt: isRead ? Date.now() : null, lastPageViewed: null,
      scrollProgress, updatedAt: Date.now(),
    })
    await db.sections.bulkAdd([
      mk('s3', 'ch2', 3, false, 40),
      mk('s1', 'ch1', 1, true, null),
      mk('s2', 'ch1', 2, false, 25),
      mk('s4', 'ch2', 4, false, null),
    ])

    const allSections = await repo.getByBook('b-equiv')

    // Book-level: one in-memory pass matches the dedicated query, rounding included.
    expect(computeSectionProgress(allSections)).toEqual(await repo.getBookProgress('b-equiv'))

    // Per-chapter: the filtered slice is identical to getByChapter, ids and order.
    for (const chapterId of ['ch1', 'ch2']) {
      const slice = allSections.filter(s => s.chapterId === chapterId)
      expect(slice.map(s => s.id)).toEqual((await repo.getByChapter(chapterId)).map(s => s.id))
      expect(computeSectionProgress(slice)).toEqual(await repo.getChapterProgress(chapterId))
    }

    // A chapter with no sections must yield {0,0,0}, not NaN.
    expect(computeSectionProgress(allSections.filter(s => s.chapterId === 'ch-empty')))
      .toEqual(await repo.getChapterProgress('ch-empty'))
    expect(computeSectionProgress([])).toEqual({ read: 0, total: 0, percentage: 0 })
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

  describe('getBookProgress reads index keys only (KAN-420)', () => {
    const mk = (id: string, isRead: boolean, scrollProgress: number | null, bookId = 'b-idx'): Section => ({
      id, chapterId: 'ch1', bookId, title: id, order: 0, startPage: 1, endPage: 2,
      extractedText: 'x'.repeat(50), isRead, readAt: null, lastPageViewed: null,
      scrollProgress, updatedAt: Date.now(),
    })
    const fullRead = async (bookId: string) =>
      computeSectionProgress(await db.sections.where('bookId').equals(bookId).toArray())

    it('matches the full-row computation, including float order and the 99% cap', async () => {
      // 200 sections, 199 read + one at 0: the average is 99.5 -> capped at 99
      await db.sections.bulkAdd(Array.from({ length: 200 }, (_, i) => mk(`s${String(i).padStart(3, '0')}`, i !== 117, null)))
      await db.sections.bulkAdd([mk('z1', false, 33.333333333), mk('a1', false, 0.1), mk('m1', false, 0.2), mk('other', true, null, 'b-other')])
      const got = await repo.getBookProgress('b-idx')
      expect(got).toEqual(await fullRead('b-idx'))
      expect(got.read).toBe(199)
      expect(got.total).toBe(203)
      expect(await repo.getBookProgress('b-other')).toEqual({ read: 1, total: 1, percentage: 100 })
      expect(await repo.getBookProgress('missing')).toEqual({ read: 0, total: 0, percentage: 0 })
    })

    it('never deserializes section rows', async () => {
      await db.sections.bulkAdd([mk('s1', true, null), mk('s2', false, 40)])
      const spy = vi.spyOn(IDBIndex.prototype, 'getAll')
      const cursorSpy = vi.spyOn(IDBIndex.prototype, 'openCursor')
      try {
        await repo.getBookProgress('b-idx')
        expect(spy).not.toHaveBeenCalled()
        expect(cursorSpy).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
        cursorSpy.mockRestore()
      }
    })

    it('tracks markAsRead/markAsUnread, scroll updates, put and modify', async () => {
      await db.sections.bulkAdd([mk('s1', false, null), mk('s2', false, 10), mk('s3', false, null)])
      await repo.markAsRead('s1')
      await db.sections.update('s2', { scrollProgress: 65, updatedAt: Date.now() })
      // A sync pull replaces whole rows with put — the stored derived fields must follow
      await db.sections.put({ ...mk('s3', true, 0) })
      expect(await repo.getBookProgress('b-idx')).toEqual(await fullRead('b-idx'))
      expect(await repo.getBookProgress('b-idx')).toEqual({ read: 2, total: 3, percentage: 88 })

      await repo.markAsUnread('s3')
      await db.sections.where('bookId').equals('b-idx').modify(sec => { if (sec.id === 's1') sec.scrollProgress = 20 })
      expect(await repo.getBookProgress('b-idx')).toEqual(await fullRead('b-idx'))
      await db.sections.delete('s2')
      expect(await repo.getBookProgress('b-idx')).toEqual(await fullRead('b-idx'))
    })

    it('falls back to the full read when a row is missing from the index', async () => {
      await db.sections.bulkAdd([mk('s1', true, null), mk('s2', false, NaN)])
      expect(await repo.getBookProgress('b-idx')).toEqual(await fullRead('b-idx'))
    })
  })
})
