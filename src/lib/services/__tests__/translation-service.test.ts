import { describe, it, expect, vi, afterEach } from 'vitest'
import { TranslationService } from '../translation-service'
import { needsAiKeySetup } from '../ai-api'

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

// KAN-366: a failed AI call used to throw `Translation API error (500):
// {"error":{...}}`, and word-info-panel renders err.message verbatim.
describe('TranslationService error messages (KAN-366)', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  function installErrorFetch(status: number, body: unknown) {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url ?? String(input)
      if (url === '/api/auth/token') {
        return Promise.resolve(new Response(JSON.stringify({ token: 'fake.jwt.token' }), { status: 200 }))
      }
      const text = typeof body === 'string' ? body : JSON.stringify(body)
      return Promise.resolve(new Response(text, { status }))
    }) as typeof fetch
  }

  const envelope = (code: string, message: string, status: number) => ({ error: { code, message, status } })

  it.each([
    [429, envelope('RATE_LIMITED', 'Too many requests', 429), /Too many lookups/],
    [503, envelope('AI_UNAVAILABLE', 'The AI service is busy right now', 503), /AI service is busy/],
    [500, envelope('INTERNAL_ERROR', 'Internal server error', 500), /AI service is busy/],
    [502, '<html>Bad Gateway</html>', /AI service is busy/],
  ])('a %i turns into a friendly message with no raw body', async (status, body, expected) => {
    installErrorFetch(status, body)
    const err = await new TranslationService().translateWord('hola', 'hola mundo', 'es').catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toMatch(expected)
    expect(err.message).not.toContain('{')
    expect(err.message).not.toContain('<')
  })

  // BYOK (2026-11-17): the admin-only 402 gate is gone. A reader without a
  // working key gets 409 AI_KEY_*, whose copy is written for them; the panel
  // shows it and links to Settings > AI because needsKeySetup is set.
  it.each([
    ['AI_KEY_REQUIRED', 'Add your own AI key in Settings > AI to use this.'],
    ['AI_KEY_NO_VISION', 'None of your AI keys can read images.'],
    ['AI_KEY_REJECTED', 'OpenAI rejected your key: invalid key. Check it in Settings > AI.'],
  ])('a 409 %s shows the server copy and asks for key setup', async (code, message) => {
    installErrorFetch(409, envelope(code, message, 409))
    const err = await new TranslationService().translateWord('hola', 'hola mundo', 'es').catch((e) => e)
    expect(err.message).toBe(message)
    expect(needsAiKeySetup(err)).toBe(true)
  })

  it('an AI_* rate limit keeps the provider-named copy; other errors never ask for key setup', async () => {
    installErrorFetch(429, envelope('AI_RATE_LIMITED', 'Gemini is rate-limiting your key. Wait a moment and try again.', 429))
    const err = await new TranslationService().translateWord('hola', 'hola mundo', 'es').catch((e) => e)
    expect(err.message).toMatch(/^Gemini is rate-limiting/)
    expect(needsAiKeySetup(err)).toBe(false)
  })

  it("keeps the server's own message for other 4xx envelopes", async () => {
    installErrorFetch(400, envelope('VALIDATION_ERROR', 'Invalid request body', 400))
    await expect(new TranslationService().translateSentence('hola', '', 'es')).rejects.toThrow('Invalid request body')
  })

  it('falls back to a generic message for a non-JSON 4xx body', async () => {
    installErrorFetch(404, 'Not Found')
    await expect(new TranslationService().explainContent('x', '')).rejects.toThrow('Translation failed (404) — try again.')
  })

  it('explainImage never echoes an upstream error body', async () => {
    installErrorFetch(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })
    const err = await new TranslationService().explainImage('https://x/img.png', '').catch((e) => e)
    expect(err.message).toMatch(/AI service is busy/)
    expect(err.message).not.toContain('{')
  })

  it('explainImage goes to nibble-api with the session token, never to a provider with a key', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url === '/api/auth/token') return Promise.resolve(new Response(JSON.stringify({ token: 'fake.jwt.token' })))
      return Promise.resolve(new Response(JSON.stringify({ explanation: 'A bar chart.' })))
    }) as typeof fetch

    const text = await new TranslationService().explainImage('https://cdn.mathpix.com/fig.png', 'Figure 2')

    expect(text).toBe('A bar chart.')
    const api = calls.find((c) => c.url.endsWith('/ai/explain-image'))!
    expect(JSON.parse(String(api.init?.body))).toEqual({ imageUrl: 'https://cdn.mathpix.com/fig.png', surroundingContext: 'Figure 2' })
    expect((api.init?.headers as Record<string, string>).Authorization).toBe('Bearer fake.jwt.token')
    expect(calls.some((c) => c.url.includes('anthropic.com'))).toBe(false)
    expect(JSON.stringify(api.init?.headers)).not.toContain('x-api-key')
  })
})
