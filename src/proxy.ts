import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Lightweight auth protection — checks session cookie at the edge.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Public routes — no auth required
  const publicPaths = ['/welcome', '/auth/login', '/auth/register', '/api/auth', '/api/admin/register']
  const isPublic = publicPaths.some(p => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  // Check for session token (next-auth v5 stores it in cookies)
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ??
    request.cookies.get('__Secure-authjs.session-token')?.value

  if (!sessionToken) {
    // A visitor arriving at the bare domain gets the product page. Any deeper
    // link is someone's bookmark into their own library, so it still goes to
    // sign-in with the callbackUrl below.
    if (pathname === '/' && !search) {
      return NextResponse.redirect(new URL('/welcome', request.url))
    }

    const loginUrl = new URL('/auth/login', request.url)
    // Keep the query string — deep links carry restore params (?sp=&wi=) and
    // tab selectors (?tab=keymap) that are lost forever if dropped here.
    loginUrl.searchParams.set('callbackUrl', pathname + search)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png).*)'],
}
