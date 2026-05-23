import { db } from '@/lib/db/database'
import { syncService } from '@/lib/services/sync-service'

/**
 * Wipe per-user local state before sign-out so a different user on the same
 * browser profile can't see the prior user's library / vocab / sync log.
 * Each step is independently guarded — a single failure must not prevent
 * the caller from completing sign-out.
 */
export async function clearLocalUserData(): Promise<void> {
  try {
    syncService.destroy()
  } catch (err) {
    console.warn('[clearLocalUserData] syncService.destroy failed', err)
  }

  try {
    await db.sections.clear()
    await db.chapters.clear()
    await db.vocabulary.clear()
    await db.books.clear()
  } catch (err) {
    console.warn('[clearLocalUserData] IndexedDB clear failed', err)
  }

  try {
    syncService.clearLocalSyncState()
  } catch (err) {
    console.warn('[clearLocalUserData] localStorage clear failed', err)
  }
}
