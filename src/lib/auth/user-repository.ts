/**
 * Server-side user repository for authentication.
 * Uses the shared Railway Postgres database (same as nibble-api).
 * Maps to the existing `users` and `oauth_accounts` tables.
 */
import { getDb, generateId } from './db'
import bcrypt from 'bcryptjs'

const EMOJI_AVATARS = [
  '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦉', '🦋', '🐙',
  '🐢', '🦈', '🐬', '🦜', '🐝', '🦄', '🐲', '🌸', '🌻', '🍀',
  '🌈', '⭐', '🔥', '💎', '🎯', '🎨', '🎵', '🚀', '🌊', '🍄',
  '🎪', '🎭', '🧊', '🪐', '🌙', '☀️', '🍉', '🥑', '🧁', '🍩',
]

function randomEmoji(): string {
  return EMOJI_AVATARS[Math.floor(Math.random() * EMOJI_AVATARS.length)]
}

export interface AuthUser {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  passwordHash: string | null
  image: string | null
  role: 'admin' | 'user'
  createdAt: Date
  updatedAt: Date
}

export interface LinkedAccount {
  id: string
  userId: string
  provider: string
  providerAccountId: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
}

interface UserRow {
  id: string
  name: string | null
  email: string
  email_verified: boolean
  password_hash: string | null
  avatar_url: string | null
  auth_role: string
  created_at: Date
  updated_at: Date
}

function rowToUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    passwordHash: row.password_hash,
    image: row.avatar_url,
    role: row.auth_role === 'admin' ? 'admin' : 'user',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class UserRepository {
  /** Find user by ID */
  async getById(id: string): Promise<AuthUser | null> {
    const sql = getDb()
    const rows = await sql<UserRow[]>`SELECT * FROM users WHERE id = ${id} LIMIT 1`
    return rows.length > 0 ? rowToUser(rows[0]) : null
  }

  /** Find user by email (case-insensitive) */
  async getByEmail(email: string): Promise<AuthUser | null> {
    const sql = getDb()
    const rows = await sql<UserRow[]>`SELECT * FROM users WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1`
    return rows.length > 0 ? rowToUser(rows[0]) : null
  }

  /** Create a user with password */
  async createWithPassword(
    email: string,
    password: string,
    name: string,
    role: 'admin' | 'user' = 'user',
  ): Promise<AuthUser> {
    const sql = getDb()
    const passwordHash = await bcrypt.hash(password, 12)
    const emoji = randomEmoji()
    const rows = await sql<UserRow[]>`
      INSERT INTO users (email, password_hash, name, auth_role, avatar_url)
      VALUES (${email.toLowerCase()}, ${passwordHash}, ${name}, ${role}, ${emoji})
      RETURNING *
    `
    return rowToUser(rows[0])
  }

  /** Create a user from OAuth (no password) */
  async createFromOAuth(
    email: string,
    name: string | null,
    image: string | null,
  ): Promise<AuthUser> {
    const sql = getDb()
    const avatarUrl = image ?? randomEmoji()
    const rows = await sql<UserRow[]>`
      INSERT INTO users (email, name, avatar_url, email_verified)
      VALUES (${email.toLowerCase()}, ${name}, ${avatarUrl}, ${true})
      RETURNING *
    `
    return rowToUser(rows[0])
  }

  /** Verify password for a user */
  async verifyPassword(user: AuthUser, password: string): Promise<boolean> {
    if (!user.passwordHash) return false
    return bcrypt.compare(password, user.passwordHash)
  }

  /** Set/update password for a user */
  async setPassword(userId: string, password: string): Promise<void> {
    const sql = getDb()
    const passwordHash = await bcrypt.hash(password, 12)
    await sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = NOW() WHERE id = ${userId}`
  }

  /** Update user profile */
  async updateProfile(userId: string, data: { name?: string; image?: string }): Promise<void> {
    const sql = getDb()
    if (data.name !== undefined && data.image !== undefined) {
      await sql`UPDATE users SET name = ${data.name}, avatar_url = ${data.image}, updated_at = NOW() WHERE id = ${userId}`
    } else if (data.name !== undefined) {
      await sql`UPDATE users SET name = ${data.name}, updated_at = NOW() WHERE id = ${userId}`
    } else if (data.image !== undefined) {
      await sql`UPDATE users SET avatar_url = ${data.image}, updated_at = NOW() WHERE id = ${userId}`
    }
  }

  /** Link an OAuth account to a user */
  async linkAccount(
    userId: string,
    provider: string,
    providerAccountId: string,
    tokens: { accessToken?: string; refreshToken?: string; expiresAt?: number; idToken?: string; scope?: string; tokenType?: string },
  ): Promise<void> {
    const sql = getDb()
    await sql`
      INSERT INTO oauth_accounts (user_id, provider, provider_account_id, access_token, refresh_token, expires_at, token_type, scope, id_token)
      VALUES (${userId}, ${provider}, ${providerAccountId}, ${tokens.accessToken ?? null}, ${tokens.refreshToken ?? null}, ${tokens.expiresAt ?? null}, ${tokens.tokenType ?? null}, ${tokens.scope ?? null}, ${tokens.idToken ?? null})
      ON CONFLICT (provider, provider_account_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at
    `
    await sql`UPDATE users SET email_verified = true, updated_at = NOW() WHERE id = ${userId}`
  }

  /** Get linked accounts for a user */
  async getLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
    const sql = getDb()
    const rows = await sql<{ id: string; user_id: string; provider: string; provider_account_id: string; access_token: string | null; refresh_token: string | null; expires_at: number | null }[]>`
      SELECT * FROM oauth_accounts WHERE user_id = ${userId}
    `
    return rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
      expiresAt: row.expires_at,
    }))
  }

  /** Find user by OAuth provider account */
  async getByProviderAccount(provider: string, providerAccountId: string): Promise<AuthUser | null> {
    const sql = getDb()
    const rows = await sql<UserRow[]>`
      SELECT u.* FROM users u
      JOIN oauth_accounts a ON u.id = a.user_id
      WHERE a.provider = ${provider} AND a.provider_account_id = ${providerAccountId}
      LIMIT 1
    `
    return rows.length > 0 ? rowToUser(rows[0]) : null
  }

  /** List all users (admin) */
  async listAll(): Promise<AuthUser[]> {
    const sql = getDb()
    const rows = await sql<UserRow[]>`SELECT * FROM users ORDER BY created_at DESC`
    return rows.map(rowToUser)
  }

  /** Update user role (admin) */
  async updateRole(userId: string, role: 'admin' | 'user'): Promise<void> {
    const sql = getDb()
    await sql`UPDATE users SET auth_role = ${role}, updated_at = NOW() WHERE id = ${userId}`
  }
}
