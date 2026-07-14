import { describe, it, expect, vi, afterEach } from 'vitest'
import { TranslationService } from '../translation-service'

// Regression coverage for KAN-260: TranslationService fetches must be bounded
// by a deadline. Before this fix, a stalled upstream left the word/sentence
// panel spinner running forever because the only abort was on unmount.

/**
 * Install a fetch mock that:
 *  - answers /api/auth/token so getToken() succeeds
 *  - for any other URL, returns a promise that NEVER resolves on its own and
 *    only rejects when the passed AbortSignal aborts (mirroring real fetch).
 */
function installHangingFetch() {
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
    if (url === '/api/auth/token') {
      return Promise.resolve(
        new Response(JSON.stringify({ token: 'fake.jwt.token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return // never settles
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }) as typeof fetch
}

describe('TranslationService deadline (KAN-260)', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('rejects with a friendly message when the deadline fires', async () => {
    installHangingFetch()
    // Control the deadline signal instead of waiting the real 25s.
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)

    const svc = new TranslationService()
    const p = svc.translateWord('hola', 'hola mundo', 'es')

    // Simulate the deadline elapsing.
    deadline.abort(new DOMException('The operation timed out.', 'TimeoutError'))

    await expect(p).rejects.toThrow('Translation timed out — try again.')
  })

  it('still aborts on the caller signal (unmount) without the friendly rewrite', async () => {
    installHangingFetch()
    // Deadline signal that never fires, so only the caller abort can settle.
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const caller = new AbortController()

    const svc = new TranslationService()
    const p = svc.translateWord('hola', 'hola mundo', 'es', caller.signal)

    // Caller unmount aborts before the deadline.
    caller.abort()

    // Rejects as an AbortError (name preserved), NOT the timeout message — so
    // word-info-panel's `err?.name === 'AbortError'` early-return still works.
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
