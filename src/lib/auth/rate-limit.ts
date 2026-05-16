/**
 * In-memory token-bucket rate limiter for the Next.js auth surface.
 * Mirrors nibble-api/src/middleware/rate-limit.ts so behavior is consistent
 * across both repos. Per-IP and per-email keying are both supported.
 *
 * Limitation: state lives in the Node runtime memory of a single Next.js
 * instance. Behind multiple replicas the effective limit scales with
 * replica count. That is acceptable for the threat model here (single-IP
 * DoS / credential stuffing) but a Redis-backed store would be required
 * for stricter enforcement.
 */

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Cleanup eviction must respect the longest configured window so per-request
// filtering still has timestamps to inspect. Otherwise long-window limiters
// (e.g. 5/hour) degrade to ~5/cleanup-interval.
let maxWindowMs = 60_000
let cleanupStarted = false

function ensureCleanup() {
  if (cleanupStarted) return
  cleanupStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter(t => now - t < maxWindowMs)
      if (entry.timestamps.length === 0) store.delete(key)
    }
  }, 60_000)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  /** Seconds until the next slot frees up (0 when allowed). */
  retryAfter: number
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  ensureCleanup()
  if (windowMs > maxWindowMs) maxWindowMs = windowMs

  const now = Date.now()
  const entry = store.get(key) ?? { timestamps: [] }
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs)

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0]
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    store.set(key, entry)
    return { allowed: false, remaining: 0, retryAfter }
  }

  entry.timestamps.push(now)
  store.set(key, entry)
  return { allowed: true, remaining: maxRequests - entry.timestamps.length, retryAfter: 0 }
}

/** Extract the client IP from forwarding headers, falling back to "anonymous". */
export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get('x-forwarded-for')
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim()
    if (first) return first
  }
  const real = headers.get('x-real-ip')
  return real ?? 'anonymous'
}
