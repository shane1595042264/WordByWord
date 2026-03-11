/**
 * Server-side user repository for authentication.
 * Works with the sql.js auth database.
 */
import { getAuthDb, persist, generateId } from './db'
import bcrypt from 'bcryptjs'

export interface AuthUser {
  id: string
  name: string | null
  email: string
  emailVerified: boolean
  passwordHash: string | null
  image: string | null
  role: 'admin' | 'user'
  createdAt: number
  updatedAt: number
}

export interface LinkedAccount {
  id: string
  userId: string
  provider: string
  providerAccountId: string
  type: string
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
}

function rowToUser(row: Record<string, unknown>): AuthUser {
  return {
    id: row.id as string,
    name: row.name as string | null,
    email: row.email as string,
    emailVerified: !!(row.email_verified as number),
    passwordHash: row.password_hash as string | null,
    image: row.image as string | null,
    role: (row.role as string) === 'admin' ? 'admin' : 'user',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export class UserRepository {
  /** Find user by ID */
  async getById(id: string): Promise<AuthUser | null> {
    const db = await getAuthDb()
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?')
    stmt.bind([id])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return rowToUser(row)
    }
    stmt.free()
    return null
  }

  /** Find user by email */
  async getByEmail(email: string): Promise<AuthUser | null> {
    const db = await getAuthDb()
    const stmt = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE')
    stmt.bind([email.toLowerCase()])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return rowToUser(row)
    }
    stmt.free()
    return null
  }

  /** Create a user with password */
  async createWithPassword(
    email: string,
    password: string,
    name: string,
    role: 'admin' | 'user' = 'user',
  ): Promise<AuthUser> {
    const db = await getAuthDb()
    const id = generateId()
    const passwordHash = await bcrypt.hash(password, 12)
    const now = Date.now()

    db.run(
      'INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, email.toLowerCase(), passwordHash, name, role, now, now],
    )
    persist()
    return (await this.getById(id))!
  }

  /** Create a user from OAuth (no password) */
  async createFromOAuth(
    email: string,
    name: string | null,
    image: string | null,
  ): Promise<AuthUser> {
    const db = await getAuthDb()
    const id = generateId()
    const now = Date.now()

    db.run(
      'INSERT INTO users (id, email, name, image, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [id, email.toLowerCase(), name, image, now, now],
    )
    persist()
    return (await this.getById(id))!
  }

  /** Verify password for a user */
  async verifyPassword(user: AuthUser, password: string): Promise<boolean> {
    if (!user.passwordHash) return false
    return bcrypt.compare(password, user.passwordHash)
  }

  /** Set/update password for a user (used when linking accounts) */
  async setPassword(userId: string, password: string): Promise<void> {
    const db = await getAuthDb()
    const passwordHash = await bcrypt.hash(password, 12)
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [passwordHash, Date.now(), userId])
    persist()
  }

  /** Update user profile */
  async updateProfile(userId: string, data: { name?: string; image?: string }): Promise<void> {
    const db = await getAuthDb()
    const updates: string[] = []
    const values: unknown[] = []

    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name) }
    if (data.image !== undefined) { updates.push('image = ?'); values.push(data.image) }
    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(userId)

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values as string[])
    persist()
  }

  /** Link an OAuth account to a user */
  async linkAccount(
    userId: string,
    provider: string,
    providerAccountId: string,
    tokens: { accessToken?: string; refreshToken?: string; expiresAt?: number; idToken?: string; scope?: string; tokenType?: string },
  ): Promise<void> {
    const db = await getAuthDb()
    const id = generateId()
    db.run(
      `INSERT INTO accounts (id, user_id, provider, provider_account_id, type, access_token, refresh_token, expires_at, token_type, scope, id_token)
       VALUES (?, ?, ?, ?, 'oauth', ?, ?, ?, ?, ?, ?)`,
      [id, userId, provider, providerAccountId, tokens.accessToken ?? null, tokens.refreshToken ?? null, tokens.expiresAt ?? null, tokens.tokenType ?? null, tokens.scope ?? null, tokens.idToken ?? null],
    )
    // Mark email as verified since OAuth provider verified it
    db.run('UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?', [Date.now(), userId])
    persist()
  }

  /** Get linked accounts for a user */
  async getLinkedAccounts(userId: string): Promise<LinkedAccount[]> {
    const db = await getAuthDb()
    const stmt = db.prepare('SELECT * FROM accounts WHERE user_id = ?')
    stmt.bind([userId])
    const accounts: LinkedAccount[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject()
      accounts.push({
        id: row.id as string,
        userId: row.user_id as string,
        provider: row.provider as string,
        providerAccountId: row.provider_account_id as string,
        type: row.type as string,
        accessToken: row.access_token as string | null,
        refreshToken: row.refresh_token as string | null,
        expiresAt: row.expires_at as number | null,
      })
    }
    stmt.free()
    return accounts
  }

  /** Find user by OAuth provider account */
  async getByProviderAccount(provider: string, providerAccountId: string): Promise<AuthUser | null> {
    const db = await getAuthDb()
    const stmt = db.prepare(
      'SELECT u.* FROM users u JOIN accounts a ON u.id = a.user_id WHERE a.provider = ? AND a.provider_account_id = ?',
    )
    stmt.bind([provider, providerAccountId])
    if (stmt.step()) {
      const row = stmt.getAsObject()
      stmt.free()
      return rowToUser(row)
    }
    stmt.free()
    return null
  }

  /** List all users (admin) */
  async listAll(): Promise<AuthUser[]> {
    const db = await getAuthDb()
    const stmt = db.prepare('SELECT * FROM users ORDER BY created_at DESC')
    const users: AuthUser[] = []
    while (stmt.step()) {
      users.push(rowToUser(stmt.getAsObject()))
    }
    stmt.free()
    return users
  }
}
