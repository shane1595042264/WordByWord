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
