import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * Lightweight auth protection — checks session cookie at the edge.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Public routes — no auth required
  const publicPaths = ['/auth/login', '/auth/register', '/api/auth', '/api/admin']
  const isPublic = publicPaths.some(p => pathname.startsWith(p))
  if (isPublic) return NextResponse.next()

  // Check for session token (next-auth v5 stores it in cookies)
  const sessionToken =
    request.cookies.get('authjs.session-token')?.value ??
    request.cookies.get('__Secure-authjs.session-token')?.value

  if (!sessionToken) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
