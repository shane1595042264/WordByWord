import { describe, it, expect, beforeEach } from 'vitest'
import { SectionRepository } from '../section-repository'
import { db } from '@/lib/db/database'
import type { Section } from '@/lib/db/models'

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
})
