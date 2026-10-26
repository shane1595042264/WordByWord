import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { db } from '@/lib/db/database'

// KAN-360: saveStructure's 409 path pulls once to refresh the lock token, then retries.
// syncService.sync() is a no-op skip while another sync is in flight, so the retry
// re-sent the same stale token and the user got a false StaleBookError.

const STALE = '2026-10-01T00:00:00.000Z'
const FRESH = '2026-10-02T00:00:00.000Z'

// Mirrors the real sync() / syncAfterInFlight() contract (covered in sync-service.test.ts):
// sync() skips while a sync is in flight; syncAfterInFlight() waits it out and then pulls.
let releaseInFlight!: () => void
const fakeSync = {
  inFlight: null as Promise<void> | null,
  async pull() {
    const local = await db.books.where('remoteId').equals('remote-1').first()
    await db.books.update(local!.id, { serverUpdatedAt: new Date(FRESH).getTime() })
  },
  async sync() {
    if (this.inFlight) return { status: 'skipped', reason: 'in-progress' }
    await this.pull()
    return { status: 'complete' }
  },
  async syncAfterInFlight() {
    while (this.inFlight) await this.inFlight
    return this.sync()
  },
}

vi.mock('@/lib/services/sync-service', () => ({ syncService: fakeSync }))

describe('StructureService.saveStructure() — 409 retry with a sync in flight (KAN-360)', () => {
  const realFetch = globalThis.fetch
  let putTokens: Array<string | undefined>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    await db.books.add({
      id: 'local-1',
      remoteId: 'remote-1',
      title: 'Book',
      serverUpdatedAt: new Date(STALE).getTime(),
    } as never)

    putTokens = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === '/api/auth/token') return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      if (url.endsWith('/books/remote-1/structure')) {
        const { expectedUpdatedAt } = JSON.parse(String(init?.body))
        putTokens.push(expectedUpdatedAt)
        return expectedUpdatedAt === FRESH
          ? new Response(JSON.stringify({ updatedAt: '2026-10-03T00:00:00.000Z' }), { status: 200 })
          : new Response(JSON.stringify({ error: 'STALE_BOOK', currentUpdatedAt: FRESH }), { status: 409 })
      }
      throw new Error('Unexpected fetch in test: ' + url)
    }) as typeof fetch

    fakeSync.inFlight = new Promise<void>((r) => {
      releaseInFlight = () => { fakeSync.inFlight = null; r() }
    })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    fakeSync.inFlight = null
  })

  it('waits for the in-flight sync and retries with the refreshed token', async () => {
    const { StructureService } = await import('../structure-service')
    const save = new StructureService().saveStructure('remote-1', [{ title: 'Ch 1', startPage: 1, endPage: 5 }])

    await vi.waitFor(() => expect(putTokens).toHaveLength(1))
    // The retry must not go out while the other sync is still running.
    await new Promise((r) => setTimeout(r, 20))
    expect(putTokens).toHaveLength(1)

    releaseInFlight()
    await expect(save).resolves.toEqual({ updatedAt: '2026-10-03T00:00:00.000Z' })
    expect(putTokens).toEqual([STALE, FRESH])
  })
})

describe('StructureService.suggestFromTOC() failure copy', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })

  function installSuggestFetch(status: number, body: unknown) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input)
      if (url === '/api/auth/token') return new Response(JSON.stringify({ token: 't' }), { status: 200 })
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch
  }

  // KAN-367: the AI-access gate's 402 carried billing copy the editor printed verbatim.
  it('maps the AI-access 402 to its own copy instead of the server string', async () => {
    installSuggestFetch(402, { error: { code: 'PAYMENT_REQUIRED', message: 'Processing job not yet paid', status: 402 } })
    const { StructureService } = await import('../structure-service')
    await expect(new StructureService().suggestFromTOC('remote-1', [1])).rejects.toThrow("AI Suggest isn't enabled for this account.")
  })

  it("keeps the server's own message for other failures (KAN-313)", async () => {
    installSuggestFetch(502, { error: { code: 'AI_ERROR', message: 'AI response was truncated', status: 502 } })
    const { StructureService } = await import('../structure-service')
    await expect(new StructureService().suggestFromTOC('remote-1', [1])).rejects.toThrow('AI response was truncated')
  })
})
