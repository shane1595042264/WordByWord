import { auth } from '@/lib/auth/config'
import { SignJWT } from 'jose'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!)

  const token = await new SignJWT({
    email: session.user.email!,
    name: session.user.name ?? '',
    role: (session.user as any).role ?? 'user',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.user.id)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret)

  return NextResponse.json({ token })
}
