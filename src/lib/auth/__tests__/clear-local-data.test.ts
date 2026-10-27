import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'
import { clearLocalUserData, ensureLocalDataOwner, signOutLocalData, LOCAL_OWNER_KEY, SIGN_OUT_FLUSH_TIMEOUT_MS } from '../clear-local-data'
import { syncService } from '@/lib/services/sync-service'
import { SettingsService } from '@/lib/services/settings-service'

function seedBook(id: string) {
  return db.books.add({
    id,
    title: `Book ${id}`,
    author: 'A',
    totalPages: 1,
    coverImage: null,
    structureSource: 'native',
    processingStatus: 'complete',
    createdAt: 1,
    updatedAt: 1,
  } as Book)
}

describe('ensureLocalDataOwner (KAN-351)', () => {
  beforeEach(async () => {
    localStorage.clear()
    await db.books.clear()
  })

  it('wipes the previous owner\'s library and sync cursors when a different user signs in', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    localStorage.setItem('nibble_lastPushedAt', '123')
    await seedBook('a-book')

    await ensureLocalDataOwner('user-b')

    expect(await db.books.count()).toBe(0)
    expect(localStorage.getItem('nibble_lastPushedAt')).toBeNull()
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBe('user-b')
  })

  it('leaves the same user\'s local-only books alone on reload', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    localStorage.setItem('nibble_lastPushedAt', '123')
    await seedBook('a-book')

    await ensureLocalDataOwner('user-a')

    expect(await db.books.count()).toBe(1)
    expect(localStorage.getItem('nibble_lastPushedAt')).toBe('123')
  })

  it('claims data with no recorded owner instead of wiping it', async () => {
    await seedBook('legacy-book')

    await ensureLocalDataOwner('user-a')

    expect(await db.books.count()).toBe(1)
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBe('user-a')
  })

  it('an owner change drops the previous user\'s settings and API key instead of pushing them (KAN-364)', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    const svc = new SettingsService()
    svc.updateSettings({ targetLanguage: 'ja', anthropicApiKey: 'sk-user-a' })
    svc.markSettingsSynced(svc.getSettingsUpdatedAt())

    await ensureLocalDataOwner('user-b')

    expect(localStorage.getItem('bbb-settings')).toBeNull()
    expect(svc.hasPendingSettingsPush()).toBe(false)
    expect(svc.getApiKey()).toBeNull()
  })

  it('sign-out leaves no settings for the next user to push or inherit (KAN-364)', async () => {
    const svc = new SettingsService()
    svc.updateSettings({ keymapOverrides: { 'normal:j': 'x' }, anthropicApiKey: 'sk-user-a' })
    svc.markSettingsSynced(svc.getSettingsUpdatedAt())

    await clearLocalUserData()

    expect(svc.hasPendingSettingsPush()).toBe(false)
    expect(svc.getApiKey()).toBeNull()
    expect(svc.getSettings().keymapOverrides).toEqual({})
  })

  it('sign-out clears the owner so the next user claims an empty DB', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    await seedBook('a-book')

    await clearLocalUserData()

    expect(await db.books.count()).toBe(0)
    expect(localStorage.getItem(LOCAL_OWNER_KEY)).toBeNull()
  })
})

describe('signOutLocalData — pending changes are pushed before the wipe (KAN-368)', () => {
  const realFetch = globalThis.fetch
  type Internals = { hasInitSynced: boolean; isSyncing: boolean; token: string | null; tokenExp: number }
  const internals = () => syncService as unknown as Internals

  /** One entry per /sync POST: the section ids it carried and how many sections IDB held at that moment. */
  let pushes: Array<{ sectionIds: string[]; localSectionsAtRequest: number }>
  let hangSync: boolean

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.delete()
    await db.open()
    localStorage.clear()
    pushes = []
    hangSync = false
    internals().token = null
    internals().tokenExp = 0
    internals().hasInitSynced = true
    internals().isSyncing = false

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url === '/api/auth/token') return new Response(JSON.stringify({ token: 'fake.jwt.token' }), { status: 200 })
      if (url.endsWith('/sync')) {
        const req = JSON.parse(init!.body as string)
        pushes.push({
          sectionIds: req.changes.sections.map((s: { id: string }) => s.id),
          localSectionsAtRequest: await db.sections.count(),
        })
        if (hangSync) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
          })
        }
        return new Response(JSON.stringify({
          syncedAt: new Date().toISOString(),
          serverChanges: { books: [], chapters: [], sections: [], vocabulary: [], settings: null },
          failedEntities: { books: [], chapters: [], sections: [], vocabulary: [] },
        }), { status: 200 })
      }
      throw new Error('Unexpected fetch in test: ' + url)
    }) as typeof fetch

    const now = Date.now()
    await db.books.add({
      id: 'b1', title: 'B', author: '', totalPages: 1, format: 'epub', coverImage: null,
      structureSource: 'native', processingStatus: 'complete', createdAt: 1, updatedAt: 1,
      remoteId: 'remote-b1', catalogId: 'cat-1',
    } as Book)
    await db.chapters.add({ id: 'ch1', bookId: 'b1', title: 'C', order: 0, startPage: 1, endPage: 1, updatedAt: 1 })
    await db.sections.add({
      id: 's1', chapterId: 'ch1', bookId: 'b1', title: 'S', order: 0, startPage: 1, endPage: 1,
      extractedText: 'text', isRead: true, readAt: now, lastPageViewed: null, scrollProgress: 0, updatedAt: now,
    } as Parameters<typeof db.sections.add>[0])
  })

  afterEach(() => {
    syncService.destroy()
    globalThis.fetch = realFetch
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('a mark-as-read still on the 30s debounce is pushed once, before IndexedDB is cleared', async () => {
    syncService.markDirty()

    await signOutLocalData()

    expect(pushes).toEqual([{ sectionIds: ['s1'], localSectionsAtRequest: 1 }])
    expect(await db.sections.count()).toBe(0)
  })

  it('nothing pending: no extra request', async () => {
    await signOutLocalData()

    expect(pushes).toEqual([])
    expect(await db.sections.count()).toBe(0)
  })

  it('an owner change does not push the previous user\'s pending changes', async () => {
    localStorage.setItem(LOCAL_OWNER_KEY, 'user-a')
    syncService.markDirty()

    await ensureLocalDataOwner('user-b')

    expect(pushes).toEqual([])
    expect(await db.sections.count()).toBe(0)
  })

  it('a push that never answers still signs out after the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      hangSync = true
      syncService.markDirty()

      const done = signOutLocalData()
      await vi.advanceTimersByTimeAsync(SIGN_OUT_FLUSH_TIMEOUT_MS)
      await done

      expect(pushes).toHaveLength(1)
      expect(await db.sections.count()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
