import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { UserRepository } from '@/lib/auth/user-repository'

const userRepo = new UserRepository()

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Authorize against the DB, never the session claim. A JWT minted before a
  // demotion still carries role:'admin' until it refreshes, and trusting it
  // here would let a demoted admin write auth_role straight back and undo
  // their own demotion. This must hold on its own, independently of the
  // token refresh in the jwt callback.
  const caller = await userRepo.getById(session.user.id)
  if (!caller || caller.role !== 'admin') {
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

  // Mirror the backend guard (KAN-271, nibble-api admin.ts:79-91): this route
  // writes the same users.auth_role column, so it must not be a way around it.
  if (role === 'user' && target.role === 'admin') {
    if (target.id === caller.id) {
      return NextResponse.json(
        { error: 'You cannot demote your own admin account' },
        { status: 409 },
      )
    }
    if ((await userRepo.countAdmins()) <= 1) {
      return NextResponse.json(
        { error: 'Cannot demote the last remaining admin' },
        { status: 409 },
      )
    }
  }

  await userRepo.updateRole(target.id, role)
  return NextResponse.json({ success: true, email, role })
}
