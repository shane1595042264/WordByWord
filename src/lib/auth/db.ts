/**
 * Server-side SQLite database for authentication.
 * Uses sql.js (WebAssembly SQLite) — no native binaries needed.
 * Database file lives at project root: auth.db
 */
import initSqlJs, { type Database } from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

const DB_PATH = join(process.cwd(), 'auth.db')

let db: Database | null = null
let sqlPromise: Promise<Database> | null = null

/** Get or create the auth database singleton */
export async function getAuthDb(): Promise<Database> {
  if (db) return db

  // Prevent multiple concurrent initializations
  if (sqlPromise) return sqlPromise

  sqlPromise = (async () => {
    const SQL = await initSqlJs({
      // In Node.js, sql.js can locate the WASM file automatically
      // but we help it by pointing to node_modules
      locateFile: (file: string) => join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
    })

    if (existsSync(DB_PATH)) {
      const buffer = readFileSync(DB_PATH)
      db = new SQL.Database(buffer)
    } else {
      db = new SQL.Database()
    }

    // Create tables if they don't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE NOT NULL,
        email_verified INTEGER DEFAULT 0,
        password_hash TEXT,
        image TEXT,
        role TEXT DEFAULT 'user',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'oauth',
        access_token TEXT,
        refresh_token TEXT,
        expires_at INTEGER,
        token_type TEXT,
        scope TEXT,
        id_token TEXT,
        UNIQUE(provider, provider_account_id)
      );

      CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `)

    persist()
    return db
  })()

  return sqlPromise
}

/** Persist in-memory database to disk */
export function persist() {
  if (!db) return
  const data = db.export()
  writeFileSync(DB_PATH, Buffer.from(data))
}

/** Generate a UUID v4 */
export function generateId(): string {
  return crypto.randomUUID()
}
