import { toast } from 'sonner'

// ─── Lazy dynamic-import() failure handling ────────────────────────────────────
//
// This project deploys on every push to main (Vercel), which renames the
// hash-named code-split chunks. Any tab left open across a deploy throws a
// ChunkLoadError the next time it evaluates a lazy `import('...')` whose old
// chunk no longer exists on the CDN. These helpers turn that silent unhandled
// rejection into a recoverable, user-visible state.

/**
 * True when a dynamic import() rejected because its hashed chunk is gone from
 * the CDN (typically after a deploy replaced the chunk filenames). Matches the
 * webpack/Next ChunkLoadError name plus the browser-native dynamic-import error
 * messages, which vary by engine.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  const name = (err as { name?: unknown }).name
  const message = (err as { message?: unknown }).message
  if (name === 'ChunkLoadError') return true
  if (typeof message !== 'string') return false
  return (
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Loading CSS chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /'?text\/html'? is not a valid JavaScript MIME type/i.test(message)
  )
}

// Guard so a burst of stale-chunk failures (every lazy import in an open tab
// fails at once after a deploy) produces a single prompt, not a toast storm.
let chunkReloadToastShown = false

/**
 * Show one app-wide "new version available" prompt with a Reload action when a
 * lazy import fails due to a stale chunk. Idempotent for the page's lifetime;
 * a no-op (returns false) for any non-chunk error so callers can fall through
 * to their own error handling. Returns true when the error was a chunk error.
 */
export function notifyChunkReloadOnce(err: unknown): boolean {
  if (!isChunkLoadError(err)) return false
  if (chunkReloadToastShown) return true
  chunkReloadToastShown = true
  toast.error('A new version of Nibbler is available.', {
    description: 'Please reload the page to continue.',
    duration: Infinity,
    action: {
      label: 'Reload',
      onClick: () => {
        if (typeof window !== 'undefined') window.location.reload()
      },
    },
  })
  return true
}

/**
 * Standard rejection handler for an unguarded lazy import(): always logs with a
 * context label, and surfaces the reload prompt when the cause is a stale chunk.
 * Callers that also flip UI/loading state should do that in their own .catch in
 * addition to (or instead of) calling this.
 */
export function reportLazyImportError(context: string, err: unknown): void {
  console.error(`[lazy-import] ${context} failed:`, err)
  notifyChunkReloadOnce(err)
}
