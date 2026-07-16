import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { syncService } from '../sync-service'
import { db } from '@/lib/db/database'

// Regression coverage for KAN-187: downloadFromCloud() must never wipe local
// IDB before the cloud payload has been received and validated, otherwise a
// transient network failure destroys the user's library.

type FetchMock = 'reject' | { status: number; body?: unknown }

function installFetchMock(syncImpl: FetchMock) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    if (url === '/api/auth/token') {
      return new Response(JSON.stringify({ token: 'fake.jwt.token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.endsWith('/sync')) {
      if (syncImpl === 'reject') throw new Error('network down')
      return new Response(
        syncImpl.body === undefined ? '' : JSON.stringify(syncImpl.body),
        { status: syncImpl.status, headers: { 'content-type': 'application/json' } },
      )
    }
    throw new Error('Unexpected fetch in test: ' + url)
  }) as typeof fetch
}

describe('syncService.downloadFromCloud()', () => {
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    await db.delete()
    await db.open()
    const now = Date.now()
    await db.books.add({
      id: 'local-book-1',
      title: 'Local Book',
      author: '',
      totalPages: 10,
      format: 'pdf',
      pdfBlob: new Blob(['x']),
      coverImage: null,
      structureSource: 'native',
      processingStatus: 'complete',
      createdAt: now,
      updatedAt: now,
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
      completedAt: null,
      remoteId: 'remote-book-1',
      catalogId: 'cat-1',
    } as Parameters<typeof db.books.add>[0])
    await db.chapters.add({
      id: 'ch-1',
      bookId: 'local-book-1',
      title: 'Ch 1',
      order: 0,
      startPage: 1,
      endPage: 10,
      updatedAt: now,
    } as Parameters<typeof db.chapters.add>[0])
    await db.sections.add({
      id: 'sec-1',
      chapterId: 'ch-1',
      bookId: 'local-book-1',
      title: 'Sec 1',
      order: 0,
      startPage: 1,
      endPage: 5,
      isRead: false,
      readAt: null,
      lastPageViewed: null,
      scrollProgress: 0,
      updatedAt: now,
      extractedText: null,
      richContent: null,
    } as Parameters<typeof db.sections.add>[0])
    await db.vocabulary.add({
      id: 'v-1',
      word: 'hello',
      pronunciation: '',
      translation: '',
      targetLanguage: '',
      contextSentence: '',
      explanation: null,
      bookTitle: '',
      sectionTitle: '',
      pageNumber: 0,
      bookId: 'local-book-1',
      reviewCount: 0,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Parameters<typeof db.vocabulary.add>[0])
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    // Reset the singleton's token cache so each test re-fetches the fake JWT.
    ;(syncService as unknown as { token: string | null; tokenExp: number }).token = null
    ;(syncService as unknown as { token: string | null; tokenExp: number }).tokenExp = 0
  })

  it('preserves local data when /sync fetch rejects', async () => {
    installFetchMock('reject')
    await expect(syncService.downloadFromCloud()).rejects.toThrow()
    expect(await db.books.count()).toBe(1)
    expect(await db.chapters.count()).toBe(1)
    expect(await db.sections.count()).toBe(1)
    expect(await db.vocabulary.count()).toBe(1)
  })

  it('preserves local data on non-2xx response', async () => {
    installFetchMock({ status: 500, body: { error: 'oops' } })
    await expect(syncService.downloadFromCloud()).rejects.toThrow(/Sync failed: 500/)
    expect(await db.books.count()).toBe(1)
    expect(await db.chapters.count()).toBe(1)
    expect(await db.sections.count()).toBe(1)
    expect(await db.vocabulary.count()).toBe(1)
  })

  it('preserves local data on a malformed sync payload', async () => {
    installFetchMock({ status: 200, body: { syncedAt: new Date().toISOString() } })
    await expect(syncService.downloadFromCloud()).rejects.toThrow(/malformed/)
    expect(await db.books.count()).toBe(1)
    expect(await db.chapters.count()).toBe(1)
    expect(await db.sections.count()).toBe(1)
    expect(await db.vocabulary.count()).toBe(1)
  })

  it('replaces local tables with the cloud payload on success', async () => {
    const syncedAt = new Date().toISOString()
    installFetchMock({
      status: 200,
      body: {
        syncedAt,
        serverChanges: {
          books: [],
          chapters: [],
          sections: [],
          vocabulary: [
            {
              id: 'cloud-v-1',
              word: 'cloud',
              bookId: 'remote-book-1',
              updatedAt: syncedAt,
              createdAt: syncedAt,
            },
          ],
        },
        failedEntities: { books: [], chapters: [], sections: [], vocabulary: [] },
      },
    })
    const result = await syncService.downloadFromCloud()
    expect(result.booksDownloaded).toBe(0)
    expect(await db.books.count()).toBe(0)
    expect(await db.chapters.count()).toBe(0)
    expect(await db.sections.count()).toBe(0)
    expect(await db.vocabulary.count()).toBe(1)
    const v = await db.vocabulary.get('cloud-v-1')
    expect(v?.word).toBe('cloud')
  })
})

// Regression coverage for KAN-245: syncNow() must not silently drop an entity
// when a sync is already in flight. sync() early-returns while isSyncing, so an
// immediate syncNow() would no-op AND leave no debounce armed to retry — the
// vocab add is stranded until an unrelated markDirty() or a page reload.
// syncNow() must now self-reschedule via the debounce when isSyncing is true.
describe('syncService.syncNow() — safety net when a sync is already in flight', () => {
  type Internals = {
    isSyncing: boolean
    debounceTimer: ReturnType<typeof setTimeout> | null
  }
  const internals = () => syncService as unknown as Internals

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Clear any timer the test armed, reset the singleton flags, restore clock.
    const s = internals()
    if (s.debounceTimer) clearTimeout(s.debounceTimer)
    s.debounceTimer = null
    s.isSyncing = false
    vi.useRealTimers()
  })

  it('arms the debounce (instead of a doomed immediate sync) when isSyncing is true', () => {
    const s = internals()
    s.isSyncing = true
    s.debounceTimer = null

    const syncSpy = vi.spyOn(syncService, 'sync').mockResolvedValue(undefined)
    syncService.syncNow()

    // No immediate sync attempt (it would just log 'already syncing' and drop the entity)...
    expect(syncSpy).not.toHaveBeenCalled()
    // ...but a debounce timer IS armed as the safety net.
    expect(s.debounceTimer).not.toBeNull()

    // Once the current sync ends and the debounce fires, sync() runs and pushes the entity.
    s.isSyncing = false
    vi.runOnlyPendingTimers()
    expect(syncSpy).toHaveBeenCalledTimes(1)

    syncSpy.mockRestore()
  })

  it('pushes immediately (no debounce) when no sync is in flight', () => {
    const s = internals()
    s.isSyncing = false
    s.debounceTimer = null

    const syncSpy = vi.spyOn(syncService, 'sync').mockResolvedValue(undefined)
    syncService.syncNow()

    // Common case unchanged: immediate push, no redundant debounce armed.
    expect(syncSpy).toHaveBeenCalledTimes(1)
    expect(s.debounceTimer).toBeNull()

    syncSpy.mockRestore()
  })
})

// Regression coverage for KAN-227: downloadFromCloud() must NOT advance
// LAST_SYNCED_KEY when any book download or vocab insert failed — otherwise
// the failed entities (all with updatedAt < syncedAt) become invisible to
// future incremental syncs.
const LAST_SYNCED_KEY = 'nibble_lastSyncedAt'

describe('syncService.downloadFromCloud() — watermark guard on partial failure', () => {
  const realFetch = globalThis.fetch
  const PRIOR_WATERMARK = '2026-01-01T00:00:00.000Z'

  function installMixedFetchMock(opts: {
    syncBody: unknown
    /** When set, /books/<id>/download returns this HTTP status. Otherwise rejects. */
    downloadStatus?: number
  }) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url === '/api/auth/token') {
        return new Response(JSON.stringify({ token: 'fake.jwt.token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/sync')) {
        return new Response(JSON.stringify(opts.syncBody), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/books/') && url.endsWith('/summary')) {
        // Force format=pdf so the bootstrap tries to download the blob.
        return new Response(JSON.stringify({ catalog: { format: 'pdf', title: 'T', author: 'A' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.includes('/books/') && url.endsWith('/download')) {
        // 404 is non-transient → downloadPdfWithRetry rethrows without retrying.
        return new Response('not found', { status: opts.downloadStatus ?? 404 })
      }
      throw new Error('Unexpected fetch in test: ' + url)
    }) as typeof fetch
  }

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.delete()
    await db.open()
    localStorage.setItem(LAST_SYNCED_KEY, PRIOR_WATERMARK)
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    localStorage.removeItem(LAST_SYNCED_KEY)
    ;(syncService as unknown as { token: string | null; tokenExp: number }).token = null
    ;(syncService as unknown as { token: string | null; tokenExp: number }).tokenExp = 0
  })

  it('stalls LAST_SYNCED_KEY when a book download fails', async () => {
    const syncedAt = '2026-06-19T10:00:00.000Z'
    installMixedFetchMock({
      syncBody: {
        syncedAt,
        serverChanges: {
          books: [{ id: 'remote-book-1', customTitle: 'Broken Book', totalPages: 5 }],
          chapters: [],
          sections: [],
          vocabulary: [],
        },
        failedEntities: { books: [], chapters: [], sections: [], vocabulary: [] },
      },
    })
    const result = await syncService.downloadFromCloud()
    expect(result.booksDownloaded).toBe(0)
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(PRIOR_WATERMARK)
  })

  it('stalls LAST_SYNCED_KEY when a vocab insert fails (duplicate-id collision in payload)', async () => {
    const syncedAt = '2026-06-19T10:00:00.000Z'
    installMixedFetchMock({
      syncBody: {
        syncedAt,
        serverChanges: {
          books: [],
          chapters: [],
          sections: [],
          // Two entries with the same id — the second .add() raises ConstraintError.
          vocabulary: [
            { id: 'dup', word: 'a', bookId: 'b', updatedAt: syncedAt, createdAt: syncedAt },
            { id: 'dup', word: 'b', bookId: 'b', updatedAt: syncedAt, createdAt: syncedAt },
          ],
        },
        failedEntities: { books: [], chapters: [], sections: [], vocabulary: [] },
      },
    })
    await syncService.downloadFromCloud()
    expect(await db.vocabulary.count()).toBe(1)
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(PRIOR_WATERMARK)
  })

  it('advances LAST_SYNCED_KEY on a fully successful bootstrap', async () => {
    const syncedAt = '2026-06-19T10:00:00.000Z'
    installMixedFetchMock({
      syncBody: {
        syncedAt,
        serverChanges: {
          books: [],
          chapters: [],
          sections: [],
          vocabulary: [{ id: 'v-ok', word: 'ok', bookId: 'b', updatedAt: syncedAt, createdAt: syncedAt }],
        },
        failedEntities: { books: [], chapters: [], sections: [], vocabulary: [] },
      },
    })
    await syncService.downloadFromCloud()
    expect(localStorage.getItem(LAST_SYNCED_KEY)).toBe(syncedAt)
  })
})

// Regression coverage for KAN-213: applyServerChanges() must swallow Dexie
// ConstraintError on .add() so a concurrent writer racing the get()/add()
// window doesn't abort the whole sync, leaving LAST_SYNCED_KEY stuck in a
// permanent replay loop. We simulate the race by stubbing the precheck get()
// to return undefined while the real row is already present in the table.
describe('syncService.applyServerChanges() — duplicate-id tolerance', () => {
  type ApplyArgs = [
    {
      books?: Record<string, unknown>[]
      chapters?: Record<string, unknown>[]
      sections?: Record<string, unknown>[]
      vocabulary?: Record<string, unknown>[]
    },
    Map<string, string>,
  ]
  const callApply = (args: ApplyArgs) =>
    (
      syncService as unknown as {
        applyServerChanges: (...a: ApplyArgs) => Promise<void>
      }
    ).applyServerChanges(...args)

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.delete()
    await db.open()
    const now = Date.now()
    await db.books.add({
      id: 'local-book-1',
      title: 'Book',
      author: '',
      totalPages: 10,
      format: 'pdf',
      pdfBlob: new Blob(['x']),
      coverImage: null,
      structureSource: 'native',
      processingStatus: 'complete',
      createdAt: now,
      updatedAt: now,
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
      completedAt: null,
      remoteId: 'remote-book-1',
      catalogId: 'cat-1',
    } as Parameters<typeof db.books.add>[0])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('chapter add: ConstraintError on duplicate id resolves and leaves the row count unchanged', async () => {
    const now = Date.now()
    await db.chapters.add({
      id: 'ch-dup',
      bookId: 'local-book-1',
      title: 'Existing',
      order: 0,
      startPage: 1,
      endPage: 10,
      updatedAt: now,
    } as Parameters<typeof db.chapters.add>[0])
    // Force the precheck miss to drive the .add() branch even though the row exists.
    vi.spyOn(db.chapters, 'get').mockResolvedValue(undefined)

    await expect(
      callApply([
        {
          chapters: [
            {
              id: 'ch-dup',
              bookId: 'remote-book-1',
              title: 'From Server',
              sortOrder: 0,
              startPage: 1,
              endPage: 10,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        new Map([['local-book-1', 'remote-book-1']]),
      ]),
    ).resolves.toBeUndefined()
    expect(await db.chapters.count()).toBe(1)
  })

  it('section add: ConstraintError on duplicate id resolves and leaves the row count unchanged', async () => {
    const now = Date.now()
    await db.chapters.add({
      id: 'ch-1',
      bookId: 'local-book-1',
      title: 'Ch',
      order: 0,
      startPage: 1,
      endPage: 10,
      updatedAt: now,
    } as Parameters<typeof db.chapters.add>[0])
    await db.sections.add({
      id: 'sec-dup',
      chapterId: 'ch-1',
      bookId: 'local-book-1',
      title: 'Existing',
      order: 0,
      startPage: 1,
      endPage: 5,
      isRead: false,
      readAt: null,
      lastPageViewed: null,
      scrollProgress: 0,
      extractedText: null,
      richContent: null,
      updatedAt: now,
    } as Parameters<typeof db.sections.add>[0])
    vi.spyOn(db.sections, 'get').mockResolvedValue(undefined)

    await expect(
      callApply([
        {
          sections: [
            {
              id: 'sec-dup',
              chapterId: 'ch-1',
              bookId: 'remote-book-1',
              title: 'From Server',
              sortOrder: 0,
              startPage: 1,
              endPage: 5,
              isRead: false,
              readAt: null,
              lastPageViewed: null,
              scrollProgress: 0,
              extractedText: null,
              richContent: null,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        new Map([['local-book-1', 'remote-book-1']]),
      ]),
    ).resolves.toBeUndefined()
    expect(await db.sections.count()).toBe(1)
  })

  it('vocabulary add: ConstraintError on duplicate id resolves and leaves the row count unchanged', async () => {
    const now = Date.now()
    await db.vocabulary.add({
      id: 'v-dup',
      word: 'existing',
      pronunciation: '',
      translation: '',
      targetLanguage: '',
      contextSentence: '',
      explanation: null,
      bookTitle: '',
      sectionTitle: '',
      pageNumber: 0,
      bookId: 'local-book-1',
      reviewCount: 0,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Parameters<typeof db.vocabulary.add>[0])
    vi.spyOn(db.vocabulary, 'get').mockResolvedValue(undefined)

    await expect(
      callApply([
        {
          vocabulary: [
            {
              id: 'v-dup',
              word: 'fromServer',
              bookId: 'remote-book-1',
              updatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
            },
          ],
        },
        new Map([['local-book-1', 'remote-book-1']]),
      ]),
    ).resolves.toBeUndefined()
    expect(await db.vocabulary.count()).toBe(1)
  })

  // Regression coverage for KAN-214: the vocab loop in applyServerChanges must
  // honour the deletedAt tombstone the server returns for soft-deleted rows,
  // mirroring the chapter/section branches. Without this, a vocab deletion on
  // Device A silently fails to propagate to Device B until a full bootstrap.
  it('vocabulary tombstone: deletedAt removes the matching local row and leaves siblings untouched', async () => {
    const now = Date.now()
    await db.vocabulary.bulkAdd([
      {
        id: 'v-to-delete',
        word: 'goodbye',
        pronunciation: '',
        translation: '',
        targetLanguage: '',
        contextSentence: '',
        explanation: null,
        bookTitle: '',
        sectionTitle: '',
        pageNumber: 0,
        bookId: 'local-book-1',
        reviewCount: 0,
        lastReviewedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'v-sibling',
        word: 'hello',
        pronunciation: '',
        translation: '',
        targetLanguage: '',
        contextSentence: '',
        explanation: null,
        bookTitle: '',
        sectionTitle: '',
        pageNumber: 0,
        bookId: 'local-book-1',
        reviewCount: 0,
        lastReviewedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ] as Parameters<typeof db.vocabulary.bulkAdd>[0])

    await callApply([
      {
        vocabulary: [
          {
            id: 'v-to-delete',
            word: 'goodbye',
            bookId: 'remote-book-1',
            updatedAt: new Date().toISOString(),
            createdAt: new Date(now).toISOString(),
            deletedAt: new Date().toISOString(),
          },
        ],
      },
      new Map([['local-book-1', 'remote-book-1']]),
    ])

    expect(await db.vocabulary.get('v-to-delete')).toBeUndefined()
    expect(await db.vocabulary.get('v-sibling')).toBeDefined()
  })

  // Regression coverage for KAN-264: the vocab UPDATE branch is gated on
  // serverUpdated > local.updatedAt, so an authoritatively newer server row must
  // merge its content fields (explanation, translation, etc.) — not just
  // reviewCount/lastReviewedAt. Previously every content edit made on another
  // device (e.g. an AI explanation) was silently dropped on pull.
  it('vocab merge: a newer server row lands its content fields (explanation/translation), not just review metadata', async () => {
    const past = Date.now() - 10_000
    await db.vocabulary.add({
      id: 'v-content',
      word: 'palabra',
      pronunciation: '',
      translation: '',
      targetLanguage: '',
      contextSentence: '',
      explanation: null,
      bookTitle: '',
      sectionTitle: '',
      pageNumber: 0,
      bookId: 'local-book-1',
      reviewCount: 2,
      lastReviewedAt: null,
      createdAt: past,
      updatedAt: past,
    } as Parameters<typeof db.vocabulary.add>[0])

    await callApply([
      {
        vocabulary: [
          {
            id: 'v-content',
            word: 'palabra',
            pronunciation: 'pa-LA-bra',
            translation: 'word',
            targetLanguage: 'en',
            contextSentence: 'una palabra nueva',
            explanation: 'Spanish for "word".',
            bookTitle: 'Mi Libro',
            sectionTitle: 'Capitulo 1',
            page: 42,
            bookId: 'remote-book-1',
            reviewCount: 1,
            lastReviewedAt: null,
            createdAt: new Date(past).toISOString(),
            // Newer than the local `past` timestamp → server wins.
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      new Map([['local-book-1', 'remote-book-1']]),
    ])

    const merged = await db.vocabulary.get('v-content')
    expect(merged?.explanation).toBe('Spanish for "word".')
    expect(merged?.translation).toBe('word')
    expect(merged?.pronunciation).toBe('pa-LA-bra')
    expect(merged?.contextSentence).toBe('una palabra nueva')
    expect(merged?.targetLanguage).toBe('en')
    expect(merged?.bookTitle).toBe('Mi Libro')
    expect(merged?.sectionTitle).toBe('Capitulo 1')
    expect(merged?.pageNumber).toBe(42)
    // reviewCount stays monotonic (Math.max), not overwritten by the lower server value.
    expect(merged?.reviewCount).toBe(2)
  })

  it('vocab merge: a NOT-newer server row leaves local content untouched', async () => {
    const now = Date.now()
    await db.vocabulary.add({
      id: 'v-stale',
      word: 'palabra',
      pronunciation: 'local-pron',
      translation: 'local-translation',
      targetLanguage: 'en',
      contextSentence: 'local context',
      explanation: 'local explanation',
      bookTitle: 'Local Book',
      sectionTitle: 'Local Section',
      pageNumber: 7,
      bookId: 'local-book-1',
      reviewCount: 3,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
    } as Parameters<typeof db.vocabulary.add>[0])

    await callApply([
      {
        vocabulary: [
          {
            id: 'v-stale',
            word: 'palabra',
            translation: 'server-translation',
            explanation: 'server explanation',
            bookId: 'remote-book-1',
            reviewCount: 1,
            createdAt: new Date(now).toISOString(),
            // Older than local → server must NOT win.
            updatedAt: new Date(now - 5_000).toISOString(),
          },
        ],
      },
      new Map([['local-book-1', 'remote-book-1']]),
    ])

    const untouched = await db.vocabulary.get('v-stale')
    expect(untouched?.translation).toBe('local-translation')
    expect(untouched?.explanation).toBe('local explanation')
    expect(untouched?.updatedAt).toBe(now)
  })

  it('chapter add: non-ConstraintError still propagates so genuine corruption is not masked', async () => {
    vi.spyOn(db.chapters, 'get').mockResolvedValue(undefined)
    const fatal = Object.assign(new Error('disk full'), { name: 'QuotaExceededError' })
    vi.spyOn(db.chapters, 'add').mockRejectedValue(fatal)

    await expect(
      callApply([
        {
          chapters: [
            {
              id: 'ch-x',
              bookId: 'remote-book-1',
              title: 't',
              sortOrder: 0,
              startPage: 1,
              endPage: 10,
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        new Map([['local-book-1', 'remote-book-1']]),
      ]),
    ).rejects.toBe(fatal)
  })

  // Regression coverage for KAN-240: the section-update merge is gated on
  // serverUpdated > local.updatedAt, so read-state must be last-write-wins.
  // A prior `isRead: server || local` OR meant a newer isRead:false could never
  // win (false||true=true), stranding "Mark as Unread" across devices.
  it('section merge: a newer server isRead:false overrides local isRead:true and clears readAt', async () => {
    const past = Date.now() - 10_000
    await db.chapters.add({
      id: 'ch-unread',
      bookId: 'local-book-1',
      title: 'Ch',
      order: 0,
      startPage: 1,
      endPage: 10,
      updatedAt: past,
    } as Parameters<typeof db.chapters.add>[0])
    await db.sections.add({
      id: 'sec-unread',
      chapterId: 'ch-unread',
      bookId: 'local-book-1',
      title: 'Section',
      order: 0,
      startPage: 1,
      endPage: 5,
      isRead: true,
      readAt: past,
      lastPageViewed: 3,
      scrollProgress: 100,
      extractedText: null,
      richContent: null,
      updatedAt: past,
    } as Parameters<typeof db.sections.add>[0])

    await callApply([
      {
        sections: [
          {
            id: 'sec-unread',
            chapterId: 'ch-unread',
            bookId: 'remote-book-1',
            title: 'Section',
            sortOrder: 0,
            startPage: 1,
            endPage: 5,
            isRead: false,
            readAt: null,
            lastPageViewed: 3,
            scrollProgress: 1,
            extractedText: null,
            richContent: null,
            // Newer than the local `past` timestamp → server wins.
            updatedAt: new Date().toISOString(),
          },
        ],
      },
      new Map([['local-book-1', 'remote-book-1']]),
    ])

    const merged = await db.sections.get('sec-unread')
    expect(merged?.isRead).toBe(false)
    expect(merged?.readAt).toBeNull()
  })
})

// Regression coverage for KAN-263: the cloud-book download chain must honour the
// AbortSignal from sync()'s abortController so a destroy()/sign-out mid-pull
// cancels in-flight downloads instead of running to completion and writing a
// book into IndexedDB after the local sync state was cleared.
describe('sync download chain — AbortSignal propagation (KAN-263)', () => {
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    ;(syncService as unknown as { token: string | null; tokenExp: number }).token = null
    ;(syncService as unknown as { token: string | null; tokenExp: number }).tokenExp = 0
    vi.restoreAllMocks()
  })

  it('downloadPdfWithRetry rejects with AbortError and issues no fetch when the signal is already aborted', async () => {
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const ac = new AbortController()
    ac.abort()

    await expect(
      (syncService as unknown as {
        downloadPdfWithRetry: (id: string, signal?: AbortSignal) => Promise<Blob>
      }).downloadPdfWithRetry('remote-book-1', ac.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    // Aborted before any work — not even the /download (or token) fetch is issued.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('createLocalBookFromServer writes no book to IDB when the sync is destroyed mid-download', async () => {
    // The controller aborts as the /summary fetch is issued (simulating destroy()
    // firing during the pull). fetch honours the aborted signal like the real API.
    const ac = new AbortController()
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url === '/api/auth/token') {
        return new Response(JSON.stringify({ token: 'fake.jwt.token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      // Destroy fires now; a signal-honouring fetch throws AbortError.
      ac.abort()
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      throw new Error('Unexpected fetch in test: ' + url)
    }) as typeof fetch

    const sb = { id: 'remote-book-1', customTitle: 'Racing Book', totalPages: 5 }
    await expect(
      (syncService as unknown as {
        createLocalBookFromServer: (
          sb: Record<string, unknown>,
          serverChanges: unknown,
          token: string,
          signal?: AbortSignal,
        ) => Promise<string>
      }).createLocalBookFromServer(sb, { chapters: [], sections: [] }, 'fake.jwt.token', ac.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    // The book (and its structure) must NOT have landed in IndexedDB.
    expect(await db.books.count()).toBe(0)
    expect(await db.chapters.count()).toBe(0)
    expect(await db.sections.count()).toBe(0)
  })

  it('an undefined signal (downloadFromCloud path) leaves the download chain uncancellable — behavior unchanged', async () => {
    // Sanity guard for the optional-param contract: no signal => no aborted check
    // ever short-circuits, so a normal download proceeds and writes the book.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url === '/api/auth/token') {
        return new Response(JSON.stringify({ token: 'fake.jwt.token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.endsWith('/summary')) {
        // format=epub so no blob download is attempted (keeps the test PDF-free).
        return new Response(JSON.stringify({ catalog: { format: 'epub', title: 'T', author: 'A' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error('Unexpected fetch in test: ' + url)
    }) as typeof fetch

    const sb = { id: 'remote-book-1', customTitle: 'Normal Book', totalPages: 5 }
    await (syncService as unknown as {
      createLocalBookFromServer: (
        sb: Record<string, unknown>,
        serverChanges: unknown,
        token: string,
        signal?: AbortSignal,
      ) => Promise<string>
    }).createLocalBookFromServer(sb, { chapters: [], sections: [] }, 'fake.jwt.token' /* no signal */)

    expect(await db.books.count()).toBe(1)
  })
})
