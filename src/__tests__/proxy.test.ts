// @vitest-environment node
// NextRequest extends the WHATWG Request, which the shared jsdom environment
// does not reliably expose as a global.
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../proxy'
import { sanitizeCallbackUrl } from '@/lib/auth/safe-redirect'

const ORIGIN = 'https://nibbook.com'

/** Cookie-less request — the expired-session / fresh-browser case. */
function anonymousRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, ORIGIN))
}

function signedInRequest(path: string): NextRequest {
  const request = new NextRequest(new URL(path, ORIGIN))
  request.cookies.set('authjs.session-token', 'session-value')
  return request
}

/** The callbackUrl as the login page's searchParams.get() would see it. */
function callbackUrlOf(response: Response): string | null {
  const location = response.headers.get('location')
  if (location === null) return null
  return new URL(location).searchParams.get('callbackUrl')
}

describe('proxy', () => {
  it('preserves the query string on a Continue Reading deep link', () => {
    const response = proxy(anonymousRequest('/book/abc/read/def?sp=0.42&wi=118'))

    expect(response.status).toBe(307)
    expect(callbackUrlOf(response)).toBe('/book/abc/read/def?sp=0.42&wi=118')
  })

  it('preserves a single-param query string', () => {
    const response = proxy(anonymousRequest('/settings?tab=keymap'))

    expect(callbackUrlOf(response)).toBe('/settings?tab=keymap')
  })

  it('leaves a path without a query string unchanged (no trailing "?")', () => {
    const response = proxy(anonymousRequest('/book/abc/read/def'))

    expect(callbackUrlOf(response)).toBe('/book/abc/read/def')
  })

  it('redirects to the login page on the same origin', () => {
    const response = proxy(anonymousRequest('/settings?tab=keymap'))
    const location = new URL(response.headers.get('location') as string)

    expect(location.origin).toBe(ORIGIN)
    expect(location.pathname).toBe('/auth/login')
  })

  it('lets an authenticated request through untouched', () => {
    const response = proxy(signedInRequest('/book/abc/read/def?sp=0.42&wi=118'))

    expect(response.headers.get('location')).toBeNull()
  })

  it('lets public paths through without a session', () => {
    for (const path of ['/auth/login', '/auth/register', '/api/auth/session', '/api/admin/register']) {
      expect(proxy(anonymousRequest(path)).headers.get('location')).toBeNull()
    }
  })

  // The proxy emits the callbackUrl; sanitizeCallbackUrl is what consumes it on
  // the login page. Round-trip both halves so a preserved query string cannot
  // smuggle an off-site redirect past the sanitizer. A bare '//evil.com' (and
  // '/\evil.com', which WHATWG folds to the same thing) is not in this list
  // because it resolves to a different origin before the proxy ever runs —
  // '/..//evil.com' is the variant that reaches it as a '//'-leading pathname.
  it('still collapses open-redirect attempts to "/" after the round trip', () => {
    for (const path of ['/%2fevil.com?sp=0.42', '/%5cevil.com?sp=0.42', '/..//evil.com?sp=0.42']) {
      const callbackUrl = callbackUrlOf(proxy(anonymousRequest(path)))
      expect(sanitizeCallbackUrl(callbackUrl)).toBe('/')
    }
  })

  it('degrades an over-long callbackUrl to "/" rather than throwing', () => {
    const callbackUrl = callbackUrlOf(proxy(anonymousRequest(`/book/abc?sp=${'0'.repeat(2100)}`)))

    expect((callbackUrl as string).length).toBeGreaterThan(2048)
    expect(sanitizeCallbackUrl(callbackUrl)).toBe('/')
  })
})
