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
})
