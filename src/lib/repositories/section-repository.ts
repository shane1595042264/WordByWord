import { db } from '@/lib/db/database'
import type { Section } from '@/lib/db/models'
import { syncService } from '../services/sync-service'

export class SectionRepository {
  async bulkCreate(sections: Section[]): Promise<void> {
    const now = Date.now()
    const withUpdatedAt = sections.map(s => ({ ...s, updatedAt: s.updatedAt ?? now }))
    await db.sections.bulkAdd(withUpdatedAt)
    syncService.markDirty()
  }

  async getByChapter(chapterId: string): Promise<Section[]> {
    return db.sections.where('chapterId').equals(chapterId).sortBy('order')
  }

  async getByBook(bookId: string): Promise<Section[]> {
    return db.sections.where('bookId').equals(bookId).sortBy('order')
  }

  /** Mark section as read. Returns true if this was the last unread section (book just completed). */
  async markAsRead(id: string): Promise<boolean> {
    // Serialize the read-modify-write across sections + books so two concurrent
    // calls on the last unread sections of the same book can't both flip
    // book.completedAt and both return true.
    const bookJustCompleted = await db.transaction('rw', [db.sections, db.books], async () => {
      const now = Date.now()
      await db.sections.update(id, { isRead: true, readAt: now, updatedAt: now })

      const section = await db.sections.get(id)
      if (!section) return false

      const unread = await db.sections.where('bookId').equals(section.bookId).filter(s => !s.isRead).count()
      if (unread !== 0) return false

      const book = await db.books.get(section.bookId)
      if (!book || book.completedAt) return false

      await db.books.update(section.bookId, { completedAt: now, updatedAt: now })
      return true
    })

    syncService.markDirty()
    return bookJustCompleted
  }

  async markAsUnread(id: string): Promise<void> {
    await db.sections.update(id, { isRead: false, readAt: null, updatedAt: Date.now() })
    syncService.markDirty()
  }

  async updateExtractedText(id: string, text: string): Promise<void> {
    await db.sections.update(id, { extractedText: text, updatedAt: Date.now() })
  }

  async getBookProgress(bookId: string): Promise<{ read: number; total: number; percentage: number }> {
    const all = await db.sections.where('bookId').equals(bookId).toArray()
    const read = all.filter(s => s.isRead).length
    const total = all.length
    const percentage = total === 0 ? 0 : Math.round(
      all.reduce((sum, s) => sum + (s.isRead ? 100 : (s.scrollProgress ?? 0)), 0) / total
    )
    return { read, total, percentage }
  }

  async getChapterProgress(chapterId: string): Promise<{ read: number; total: number; percentage: number }> {
    const all = await db.sections.where('chapterId').equals(chapterId).toArray()
    const read = all.filter(s => s.isRead).length
    const total = all.length
    const percentage = total === 0 ? 0 : Math.round(
      all.reduce((sum, s) => sum + (s.isRead ? 100 : (s.scrollProgress ?? 0)), 0) / total
    )
    return { read, total, percentage }
  }
}
