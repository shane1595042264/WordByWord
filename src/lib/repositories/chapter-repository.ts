import { db } from '@/lib/db/database'
import type { Chapter } from '@/lib/db/models'
import { syncService } from '../services/sync-service'

export class ChapterRepository {
  async bulkCreate(chapters: Chapter[]): Promise<void> {
    const now = Date.now()
    const withUpdatedAt = chapters.map(c => ({ ...c, updatedAt: c.updatedAt ?? now }))
    await db.chapters.bulkAdd(withUpdatedAt)
    syncService.markDirty()
  }

  async getByBook(bookId: string): Promise<Chapter[]> {
    return db.chapters.where('bookId').equals(bookId).sortBy('order')
  }

  async getById(id: string): Promise<Chapter | undefined> {
    return db.chapters.get(id)
  }
}
