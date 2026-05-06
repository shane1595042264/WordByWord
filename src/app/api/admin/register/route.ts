import { NextResponse } from 'next/server'
import { UserRepository } from '@/lib/auth/user-repository'
import { checkRateLimit, getClientIp } from '@/lib/auth/rate-limit'

const userRepo = new UserRepository()

const REGISTER_RATE_LIMIT_MAX = 5
const REGISTER_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request.headers)
    const limit = checkRateLimit(`register:${ip}`, REGISTER_RATE_LIMIT_MAX, REGISTER_RATE_LIMIT_WINDOW_MS)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      )
    }

    const { email, password, name } = await request.json()

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'Email, password, and name are required' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
    }

    // Always run the bcrypt hash + INSERT path (with ON CONFLICT DO NOTHING)
    // so the response is indistinguishable between "new email" and "email
    // already in use". Returning a different status (409 vs 201) here would
    // leak account existence — see ticket KAN-147.
    await userRepo.createIfNotExists(email, password, name)

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Registration error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
