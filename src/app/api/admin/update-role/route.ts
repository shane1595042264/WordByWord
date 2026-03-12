import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { UserRepository } from '@/lib/auth/user-repository'

const userRepo = new UserRepository()

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { email, role } = await request.json()
  if (!email || !['admin', 'user'].includes(role)) {
    return NextResponse.json({ error: 'Invalid email or role' }, { status: 400 })
  }

  const target = await userRepo.getByEmail(email)
  if (!target) {
    return NextResponse.json({ error: 'User not found in local auth database' }, { status: 404 })
  }

  await userRepo.updateRole(target.id, role)
  return NextResponse.json({ success: true, email, role })
}
