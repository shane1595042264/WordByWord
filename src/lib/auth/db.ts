/**
 * Server-side Postgres connection for authentication.
 * Connects to the same Railway Postgres used by nibble-api.
 * Requires DATABASE_URL environment variable.
 */
import postgres from 'postgres'

let sql: ReturnType<typeof postgres> | null = null

/** Get the shared Postgres client singleton */
export function getDb() {
  if (sql) return sql

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL environment variable is required')
  }

  sql = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  return sql
}

/** Generate a UUID v4 */
export function generateId(): string {
  return crypto.randomUUID()
}
