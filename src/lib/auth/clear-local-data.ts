import { db } from '@/lib/db/database'
import { syncService } from '@/lib/services/sync-service'

/**
 * Id of the user whose data is in this browser's IndexedDB. Sign Out is not
 * the only way a session ends (JWT expiry, cleared cookies, a forced logout),
 * so the next sign-in compares against this instead of trusting that the
 * previous user cleaned up after themselves (KAN-351).
 */
export const LOCAL_OWNER_KEY = 'nibble_localOwnerId'

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

  try {
    localStorage.removeItem(LOCAL_OWNER_KEY)
  } catch (err) {
    console.warn('[clearLocalUserData] owner key clear failed', err)
  }
}

/** How long Sign Out waits for pending changes to reach the server. */
export const SIGN_OUT_FLUSH_TIMEOUT_MS = 8000

/**
 * The Sign Out path: push pending changes while the session token is still
 * valid, then wipe. A failed or timed-out flush still wipes — sign-out must
 * not be blockable by the network (KAN-368).
 */
export async function signOutLocalData(): Promise<void> {
  try {
    const flushed = await syncService.flushPending(SIGN_OUT_FLUSH_TIMEOUT_MS)
    if (!flushed) console.warn('[signOutLocalData] recent changes could not be saved before sign-out')
  } catch (err) {
    console.warn('[signOutLocalData] flush failed', err)
  }
  await clearLocalUserData()
}

/**
 * Make sure the local data belongs to `userId` before sync starts. A
 * different stored owner means their session ended without Sign Out, so wipe
 * it first. No stored owner is claimed as-is: data that predates the owner key
 * can't be attributed, and wiping it would throw away every existing user's
 * local-only books and unpushed progress on the first load after this shipped.
 */
export async function ensureLocalDataOwner(userId: string): Promise<void> {
  let owner: string | null = null
  try {
    owner = localStorage.getItem(LOCAL_OWNER_KEY)
  } catch (err) {
    console.warn('[ensureLocalDataOwner] could not read owner key', err)
  }

  if (owner === userId) return
  if (owner !== null) await clearLocalUserData()

  try {
    localStorage.setItem(LOCAL_OWNER_KEY, userId)
  } catch (err) {
    console.warn('[ensureLocalDataOwner] could not store owner key', err)
  }
}
