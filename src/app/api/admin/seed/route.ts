/**
 * POST /api/auth/seed — Create the admin account if it doesn't exist.
 * This is a one-time setup endpoint. In production, you'd protect or remove this.
 */
import { NextResponse } from 'next/server'
import { UserRepository } from '@/lib/auth/user-repository'

const userRepo = new UserRepository()

export async function POST() {
  try {
    const email = process.env.ADMIN_EMAIL
    const password = process.env.ADMIN_PASSWORD
    const name = process.env.ADMIN_NAME

    if (!email || !password || !name) {
      return NextResponse.json({ error: 'ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME env vars required' }, { status: 400 })
    }

    const existing = await userRepo.getByEmail(email)
    if (existing) {
      return NextResponse.json({ message: 'Admin already exists', user: { id: existing.id, email: existing.email, role: existing.role } })
    }

    const admin = await userRepo.createWithPassword(email, password, name, 'admin')

    return NextResponse.json({
      message: 'Admin created',
      user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    }, { status: 201 })
  } catch (error) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: 'Failed to seed admin' }, { status: 500 })
  }
}
