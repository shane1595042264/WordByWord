/**
 * POST /api/admin/seed — Ensure the admin account exists in Postgres.
 * For Google-only auth, this just ensures the user row exists with admin role.
 * The actual Google OAuth link happens on first sign-in.
 */
import { NextResponse } from 'next/server'
import { UserRepository } from '@/lib/auth/user-repository'

const userRepo = new UserRepository()

export async function POST() {
  try {
    const email = process.env.ADMIN_EMAIL

    if (!email) {
      return NextResponse.json({ error: 'ADMIN_EMAIL env var required' }, { status: 400 })
    }

    const existing = await userRepo.getByEmail(email)
    if (existing) {
      // Ensure they have admin role
      if (existing.role !== 'admin') {
        await userRepo.updateRole(existing.id, 'admin')
      }
      return NextResponse.json({ message: 'Admin already exists', user: { id: existing.id, email: existing.email, role: 'admin' } })
    }

    // Pre-create the admin user — Google OAuth will link on first sign-in
    const admin = await userRepo.createFromOAuth(email, process.env.ADMIN_NAME ?? 'Admin', null)
    await userRepo.updateRole(admin.id, 'admin')

    return NextResponse.json({
      message: 'Admin created',
      user: { id: admin.id, email: admin.email, name: admin.name, role: 'admin' },
    }, { status: 201 })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: 'Failed to seed admin' }, { status: 500 })
  }
}
