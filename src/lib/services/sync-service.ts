import { v4 as uuid } from 'uuid'
import { db } from '../db/database'
import type { Book, Chapter, Section, VocabEntry } from '../db/models'

const SYNC_DEBOUNCE_MS = 30_000
const LAST_SYNCED_KEY = 'nibble_lastSyncedAt'
const SYNC_LOG_KEY = 'nibble_syncLog'
const PENDING_VOCAB_DELETES_KEY = 'nibble_pendingVocabDeletes'
const MAX_PENDING_VOCAB_DELETES = 200

export interface CloudStatus {
  bookCount: number
  chapterCount: number
  sectionCount: number
  vocabCount: number
  lastUpdated: string | null
  books: { id: string; customTitle: string | null; catalogId: string; updatedAt: string }[]
}

export interface SyncConflict {
  localOnlyBooks: number
  cloudOnlyBooks: number
  cloudDeletedBooks: number
}

class PdfDownloadError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly transient: boolean,
  ) {
    super(message)
    this.name = 'PdfDownloadError'
  }
}

type ConflictResolver = (conflict: SyncConflict) => Promise<'cloud' | 'local' | 'auto'>

class SyncService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private isSyncing = false
  private token: string | null = null
  private tokenExp = 0
  private cleanupFns: (() => void)[] = []
  private conflictResolver: ConflictResolver | null = null
  private hasInitSynced = false
  private abortController: AbortController | null = null

  // ── Status events ──────────────────────────────────────────

  private emitStatus(
    status: 'syncing' | 'complete' | 'error',
    message: string,
    progress?: { current: number; total: number },
  ) {
    window.dispatchEvent(new CustomEvent('nibble:sync-status', {
      detail: { status, message, progress: progress ?? null },
    }))
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /** Register a callback for when sync finds conflicts (used by UI) */
  onConflict(resolver: ConflictResolver) {
    this.conflictResolver = resolver
  }

  init() {
    const onBeforeUnload = () => this.flushSync()
    window.addEventListener('beforeunload', onBeforeUnload)
    this.cleanupFns.push(() => window.removeEventListener('beforeunload', onBeforeUnload))

    // Full sync on init — always sync from epoch on first load to catch all changes
    this.hasInitSynced = false
    this.syncWithRetry()
  }

  /**
   * Attempt sync with retry — handles the race condition where
   * the session cookie may not be fully propagated yet after login.
   */
  private async syncWithRetry(retries = 3, delayMs = 1500): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const tokenBefore = await this.getToken()
      if (tokenBefore) {
        // Token available — sync will proceed normally
        await this.sync()
        return
      }
      this.log('init:retry', `token not available, attempt ${attempt}/${retries}`)
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
    // Final attempt even without token pre-check — sync() handles null gracefully
    this.log('init:retry', 'all retries exhausted, attempting final sync')
    await this.sync()
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    // Abort any in-flight sync fetch to prevent stale responses from overwriting newer data
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.cleanupFns.forEach(fn => fn())
    this.cleanupFns = []
    // Reset syncing flag so the next init() can sync successfully
    this.isSyncing = false
  }

  // ── Logging ───────────────────────────────────────────────────

  private log(action: string, details?: string) {
    const entry = `[${new Date().toISOString()}] ${action}${details ? ': ' + details : ''}`
    console.log('[sync]', entry)
    try {
      const logs = JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]') as string[]
      logs.push(entry)
      // Keep last 100 entries
      if (logs.length > 100) logs.splice(0, logs.length - 100)
      localStorage.setItem(SYNC_LOG_KEY, JSON.stringify(logs))
    } catch { /* ignore */ }
  }

  getSyncLog(): string[] {
    try {
      return JSON.parse(localStorage.getItem(SYNC_LOG_KEY) || '[]')
    } catch { return [] }
  }

  // ── Pending vocab deletes ─────────────────────────────────────
  //
  // A vocab delete is the one mutation that cannot ride the normal dirty-window
  // push: once the local row is gone there is nothing left for sync() to send.
  // The backend delete is a SOFT delete, so a DELETE that never lands leaves the
  // server row ACTIVE and the next full download resurrects the word (KAN-283).
  // Failed deletes are therefore parked in localStorage and re-issued on every
  // sync tick until the backend settles them.

  private readPendingVocabDeletes(): string[] {
    try {
      const raw = JSON.parse(localStorage.getItem(PENDING_VOCAB_DELETES_KEY) || '[]')
      return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
    } catch {
      return []
    }
  }

  private writePendingVocabDeletes(ids: string[]): void {
    try {
      if (ids.length === 0) {
        localStorage.removeItem(PENDING_VOCAB_DELETES_KEY)
        return
      }
      // Keep the newest ids if the queue ever runs away (sustained offline +
      // bulk deletes) so localStorage cannot grow without bound.
      localStorage.setItem(PENDING_VOCAB_DELETES_KEY, JSON.stringify(ids.slice(-MAX_PENDING_VOCAB_DELETES)))
    } catch { /* ignore */ }
  }

  /** Vocab ids whose backend soft-delete has not landed yet. */
  getPendingVocabDeletes(): string[] {
    return this.readPendingVocabDeletes()
  }

  private queueVocabDelete(id: string): void {
    const ids = this.readPendingVocabDeletes()
    if (ids.includes(id)) return
    ids.push(id)
    this.writePendingVocabDeletes(ids)
    this.log('vocab:delete-queued', `${id} — backend delete failed, will retry next sync`)
  }

  private unqueueVocabDelete(id: string): void {
    const ids = this.readPendingVocabDeletes()
    const next = ids.filter(x => x !== id)
    if (next.length !== ids.length) this.writePendingVocabDeletes(next)
  }

  /**
   * Issue the backend soft-delete for one vocab id.
   * Returns true when the server state is settled — 2xx, or 404 meaning the row
   * is already gone (or belongs to another user, which the backend reports as
   * notFound). Returns false for anything retryable: 5xx, network, abort.
   */
  private async deleteVocabOnServer(id: string, token: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`${this.getApiUrl()}/vocabulary/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      if (res.ok || res.status === 404) return true
      // Stale JWT — drop the cached token so the next tick fetches a fresh one.
      if (res.status === 401) this.token = null
      return false
    } catch {
      return false
    }
  }

  /**
   * Soft-delete a vocab entry on the backend. Removing the local IndexedDB row
   * is the caller's job — this makes only the SERVER side durable: on any
   * failure the id is parked and retried on every later sync tick, so a delete
   * issued while offline or with an expired session still lands instead of
   * being silently reversed by the next download-from-cloud (KAN-283).
   */
  async deleteVocabRemote(id: string): Promise<boolean> {
    const token = await this.getToken()
    if (!token) {
      this.queueVocabDelete(id)
      return false
    }
    if (await this.deleteVocabOnServer(id, token)) {
      this.unqueueVocabDelete(id)
      return true
    }
    this.queueVocabDelete(id)
    return false
  }

  /**
   * Re-issue every parked vocab delete. Runs at the head of a sync tick so an
   * id that settles here is already tombstoned by the time the POST /sync pull
   * runs — otherwise the still-active server row gets re-added locally.
   */
  private async drainVocabDeletes(token: string, signal?: AbortSignal): Promise<void> {
    const pending = this.readPendingVocabDeletes()
    if (pending.length === 0) return
    const remaining: string[] = []
    for (const id of pending) {
      if (!(await this.deleteVocabOnServer(id, token, signal))) remaining.push(id)
    }
    this.writePendingVocabDeletes(remaining)
    const settled = pending.length - remaining.length
    this.log(
      'vocab:delete-drain',
      `${settled}/${pending.length} pending delete${pending.length === 1 ? '' : 's'} settled${remaining.length ? `, ${remaining.length} still queued` : ''}`,
    )
  }

  // ── Dirty trigger ────────────────────────────────────────────

  markDirty() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.sync(), SYNC_DEBOUNCE_MS)
  }

  /**
   * Trigger a sync immediately, bypassing the debounce. Use for deliberate
   * user actions (e.g. adding a vocab word) where waiting 30s feels broken.
   *
   * If a sync is already in flight, an immediate sync() would early-return
   * (see sync(): 'already syncing') and silently drop this entity — with no
   * timer left armed to retry it. In that case we fall back to the regular
   * debounce via markDirty() so the entity is guaranteed to be picked up once
   * the current sync ends. This makes syncNow() self-rescheduling: callers no
   * longer have to arm the safety net themselves.
   */
  syncNow(): void {
    if (this.isSyncing) {
      // A sync is already running — an immediate sync() would no-op. Arm the
      // debounce so this entity still gets pushed after the current sync ends.
      this.markDirty()
      return
    }
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    void this.sync()
  }

  // ── Token management ─────────────────────────────────────────

  private async getToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExp - 60_000) {
      return this.token
    }
    try {
      const res = await fetch('/api/auth/token')
      if (!res.ok) return null
      const { token } = await res.json()
      this.token = token
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        this.tokenExp = payload.exp * 1000
      } catch {
        this.tokenExp = Date.now() + 23 * 60 * 60 * 1000
      }
      return this.token
    } catch {
      return null
    }
  }

  private getApiUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL || ''
  }

  // ── Cloud status ─────────────────────────────────────────────

  async getCloudStatus(): Promise<CloudStatus | null> {
    const token = await this.getToken()
    if (!token) return null
    try {
      const res = await fetch(`${this.getApiUrl()}/sync/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  getLastSyncedAt(): string | null {
    return localStorage.getItem(LAST_SYNCED_KEY)
  }

  /**
   * Force the next sync() call to run as a full sync from epoch.
   * Used after server-side processing finishes producing chapters/sections
   * whose updatedAt may predate the local lastSyncedAt watermark.
   */
  forceFullSyncNext(): void {
    this.hasInitSynced = false
    localStorage.removeItem(LAST_SYNCED_KEY)
  }

  /**
   * Drop the local sync watermark and rolling log. Called on sign-out so a
   * different user on the same browser profile starts from a clean slate.
   *
   * PENDING_VOCAB_DELETES_KEY is deliberately NOT cleared: dropping it would
   * reintroduce the silent-loss path KAN-283 fixed (sign out before the retry
   * lands and the delete is gone for good). A stale id drained under a different
   * user's token just 404s — the backend scopes lookups by userId — and a 404
   * counts as settled, so it self-cleans without touching their data.
   */
  clearLocalSyncState(): void {
    localStorage.removeItem(LAST_SYNCED_KEY)
    localStorage.removeItem(SYNC_LOG_KEY)
  }

  // ── Book upload ──────────────────────────────────────────────

  async uploadBook(
    file: File | Blob,
    title: string,
    author?: string,
    totalPages?: number,
    mode?: string,
  ): Promise<{ remoteId: string; catalogId: string; coverUrl?: string; jobId?: string }> {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated — please sign in to upload books.')

    const formData = new FormData()
    formData.append('file', file, `${title}.pdf`)
    formData.append('title', title)
    if (author) formData.append('author', author)
    if (totalPages) formData.append('totalPages', String(totalPages))
    if (mode) formData.append('mode', mode)

    const res = await fetch(`${this.getApiUrl()}/books/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    })
    if (!res.ok) {
      const errorData = await res.json().catch(() => null)
      const errorMsg = errorData?.error || `Upload failed (${res.status})`
      throw new Error(errorMsg)
    }
    const data = await res.json()
    // Defense in depth: a 200 with a missing book/catalogEntry (e.g. a failed server-side
    // restore that slipped past res.ok) would otherwise throw an uncaught TypeError on
    // data.book.id with no user-facing error. Surface it as a normal upload failure instead.
    if (!data?.book?.id || !data?.catalogEntry?.id) {
      throw new Error('Upload failed — the server returned an unexpected response. Please try again.')
    }
    return {
      remoteId: data.book.id,
      catalogId: data.catalogEntry.id,
      coverUrl: data.catalogEntry.coverUrl || undefined,
      jobId: data.jobId || undefined,
    }
  }

  // ── Download PDF from cloud ──────────────────────────────────

  private async downloadPdf(remoteBookId: string, signal?: AbortSignal): Promise<Blob> {
    const token = await this.getToken()
    if (!token) {
      throw new PdfDownloadError('no auth token', null, false)
    }
    let res: Response
    try {
      res = await fetch(`${this.getApiUrl()}/books/${remoteBookId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
    } catch (err) {
      // AbortError must propagate so destroy()-driven cancels don't get retried.
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new PdfDownloadError(
        `network error: ${err instanceof Error ? err.message : String(err)}`,
        null,
        true,
      )
    }
    if (!res.ok) {
      const transient = res.status >= 500 || res.status === 408 || res.status === 429
      throw new PdfDownloadError(`HTTP ${res.status}`, res.status, transient)
    }
    return await res.blob()
  }

  private async downloadPdfWithRetry(remoteBookId: string, signal?: AbortSignal): Promise<Blob> {
    const backoffsMs = [1000, 3000, 8000]
    let lastErr: unknown
    for (let attempt = 0; attempt <= backoffsMs.length; attempt++) {
      // Bail before doing any work if the sync was already destroyed.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      try {
        return await this.downloadPdf(remoteBookId, signal)
      } catch (err) {
        lastErr = err
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        const transient = err instanceof PdfDownloadError && err.transient
        if (!transient || attempt === backoffsMs.length) throw err
        this.log(
          'sync:download-retry',
          `${remoteBookId}: attempt ${attempt + 1} failed (${err instanceof Error ? err.message : String(err)}); retrying in ${backoffsMs[attempt]}ms`,
        )
        // Abortable backoff — a destroy() during the wait rejects immediately
        // instead of sleeping through the full 1s/3s/8s.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, backoffsMs[attempt])
          signal?.addEventListener('abort', () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      }
    }
    throw lastErr
  }

  // ── Core sync (bidirectional) ────────────────────────────────

  async sync(alreadyRefreshedToken = false): Promise<void> {
    if (this.isSyncing) {
      this.log('sync:skip', 'already syncing')
      return
    }
    const token = await this.getToken()
    if (!token) {
      this.log('sync:skip', 'no token available (not authenticated?)')
      return
    }

    this.isSyncing = true
    // Create an AbortController so destroy() can cancel this in-flight sync
    this.abortController = new AbortController()
    const { signal } = this.abortController
    let failedDownloads: Array<{ remoteId: string; title: string }> = []
    try {
      // On first sync after init, always sync from epoch to catch everything (deletions, new books)
      const isInitSync = !this.hasInitSynced
      const lastSyncedAt = isInitSync
        ? '1970-01-01T00:00:00.000Z'
        : (localStorage.getItem(LAST_SYNCED_KEY) || '1970-01-01T00:00:00.000Z')
      const sinceMs = new Date(lastSyncedAt).getTime()
      this.hasInitSynced = true

      this.log('sync:start', isInitSync ? 'full sync (init)' : 'incremental')
      this.emitStatus('syncing', isInitSync ? ':sync --full' : ':sync')

      // Retry parked vocab deletes BEFORE the pull below, so any that settle are
      // already tombstoned in this cycle's serverChanges instead of coming back
      // as active rows (KAN-283). No-ops when the queue is empty.
      await this.drainVocabDeletes(token, signal)

      const [dirtyBooks, dirtyChapters, dirtySections, dirtyVocab] = await Promise.all([
        db.books.where('updatedAt').above(sinceMs).toArray(),
        db.chapters.where('updatedAt').above(sinceMs).toArray(),
        db.sections.where('updatedAt').above(sinceMs).toArray(),
        db.vocabulary.where('updatedAt').above(sinceMs).toArray(),
      ])

      // Build local→remote ID map for books
      const bookRemoteIdMap = new Map<string, string>()
      const allBooks = await db.books.toArray()
      for (const b of allBooks) {
        if (b.remoteId) bookRemoteIdMap.set(b.id, b.remoteId)
      }

      // Transform — only entities whose parent book has a remoteId
      const syncBooks = dirtyBooks
        .filter(b => b.remoteId)
        .map(b => this.bookToSync(b))

      const syncChapters = dirtyChapters
        .filter(ch => bookRemoteIdMap.has(ch.bookId))
        .map(ch => this.chapterToSync(ch, bookRemoteIdMap))

      const syncSections = dirtySections
        .filter(sec => bookRemoteIdMap.has(sec.bookId))
        .map(sec => this.sectionToSync(sec, bookRemoteIdMap))

      const syncVocab = dirtyVocab
        .filter(v => !v.bookId || bookRemoteIdMap.has(v.bookId))
        .map(v => this.vocabToSync(v, bookRemoteIdMap))

      this.log('sync:push', `${syncBooks.length} books, ${syncChapters.length} chapters, ${syncSections.length} sections, ${syncVocab.length} vocab`)
      const totalDirty = syncBooks.length + syncChapters.length + syncSections.length + syncVocab.length
      if (totalDirty > 0) {
        this.emitStatus('syncing', `:push ${totalDirty} change${totalDirty === 1 ? '' : 's'}`)
      } else {
        this.emitStatus('syncing', ':pull server changes')
      }

      const res = await fetch(`${this.getApiUrl()}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lastSyncedAt,
          changes: {
            books: syncBooks,
            chapters: syncChapters,
            sections: syncSections,
            vocabulary: syncVocab,
            settings: null,
            exerciseProgress: [],
          },
        }),
        signal,
      })

      if (res.status === 401) {
        // Always clear the cached token — the JWT was rejected, so it's stale or invalid.
        this.token = null
        if (alreadyRefreshedToken) {
          // Second 401 in the same sync attempt: a fresh token also failed, so the
          // backend is persistently rejecting auth (secret mismatch, clock skew,
          // middleware regression). Surface as a hard failure instead of recursing.
          this.log('sync:error', 'HTTP 401 persisted after token refresh')
          throw new Error('Sync failed: authentication rejected after refresh')
        }
        this.isSyncing = false
        return this.sync(true)
      }

      if (!res.ok) {
        this.log('sync:error', `HTTP ${res.status}`)
        throw new Error(`Sync request failed: HTTP ${res.status}`)
      }

      const result = await res.json()
      const serverBooks = (result.serverChanges.books ?? []) as Record<string, unknown>[]

      // Detect what the server has
      const existingRemoteIds = new Set(allBooks.map(b => b.remoteId).filter(Boolean))
      const activeServerBooks = serverBooks.filter(sb => !sb.deletedAt)
      const deletedServerBooks = serverBooks.filter(sb => sb.deletedAt)
      const cloudOnlyBooks = activeServerBooks.filter(sb => !existingRemoteIds.has(sb.id as string))
      // Only detect hard-deleted books on INIT sync (from epoch) where server returns ALL books.
      // On incremental syncs, missing books just means they weren't modified — NOT deleted.
      const localOnlyBooks = isInitSync
        ? allBooks.filter(b => b.remoteId && !serverBooks.some(sb => sb.id === b.remoteId))
        : []
      // Books that exist locally but server says deleted
      const cloudDeletedBooks = deletedServerBooks.filter(sb => existingRemoteIds.has(sb.id as string))

      this.log('sync:analysis', `cloud-only: ${cloudOnlyBooks.length}, local-only: ${localOnlyBooks.length}, cloud-deleted: ${cloudDeletedBooks.length}`)

      // Check if we need conflict resolution
      const hasConflict = cloudOnlyBooks.length > 0 || cloudDeletedBooks.length > 0
      let resolution: 'auto' | 'cloud' | 'local' = 'auto'

      if (hasConflict && this.conflictResolver) {
        // Check settings for warn preference
        const { SettingsService } = await import('./settings-service')
        const settings = new SettingsService().getSettings()
        if (settings.warnBeforeSync) {
          resolution = await this.conflictResolver({
            localOnlyBooks: localOnlyBooks.length,
            cloudOnlyBooks: cloudOnlyBooks.length,
            cloudDeletedBooks: cloudDeletedBooks.length,
          })
        }
      }

      // Apply server changes to existing local entities (updates + reading progress)
      await this.applyServerChanges(result.serverChanges, bookRemoteIdMap)

      if (resolution === 'local') {
        // User chose local wins — don't download cloud books or apply deletions
        this.log('sync:resolve', 'local wins — skipping cloud changes')
      } else {
        // Auto or cloud wins — apply deletions and download new books

        // 1a. Remove locally any books the server soft-deleted
        for (const sb of cloudDeletedBooks) {
          const localBook = allBooks.find(b => b.remoteId === (sb.id as string))
          if (localBook) {
            this.log('sync:delete-local', `"${localBook.title}" soft-deleted on cloud`)
            await db.sections.where('bookId').equals(localBook.id).delete()
            await db.chapters.where('bookId').equals(localBook.id).delete()
            await db.vocabulary.where('bookId').equals(localBook.id).delete()
            await db.books.delete(localBook.id)
          }
        }

        // 1b. Remove locally any books that have a remoteId but server doesn't know about
        // (hard-deleted on server — the row is gone, not returned in serverChanges)
        for (const localBook of localOnlyBooks) {
          this.log('sync:delete-local', `"${localBook.title}" no longer on server (hard-deleted)`)
          await db.sections.where('bookId').equals(localBook.id).delete()
          await db.chapters.where('bookId').equals(localBook.id).delete()
          await db.vocabulary.where('bookId').equals(localBook.id).delete()
          await db.books.delete(localBook.id)
        }

        // 2. Download cloud-only books (parallel, concurrency of 3)
        const dlResult = await this.downloadBooksWithProgress(cloudOnlyBooks, result.serverChanges, token, signal)
        failedDownloads = dlResult.failed
      }

      // Per-entity push failures: bump local updatedAt past syncedAt so the next push retries instead of losing the row.
      const failed = result.failedEntities ?? { books: [], chapters: [], sections: [], vocabulary: [] }
      const failedBookIds = (failed.books ?? []) as string[]
      const failedChapterIds = (failed.chapters ?? []) as string[]
      const failedSectionIds = (failed.sections ?? []) as string[]
      const failedVocabIds = (failed.vocabulary ?? []) as string[]
      const failedCount = failedBookIds.length + failedChapterIds.length + failedSectionIds.length + failedVocabIds.length

      if (failedCount > 0) {
        // Must be strictly greater than syncedAt so the row re-enters the next dirty-window after LAST_SYNCED_KEY advances.
        const bumpedAt = Math.max(Date.now(), new Date(result.syncedAt).getTime() + 1)

        // Failed book ids are remoteIds; chapters/sections/vocab share the id with the server.
        const remoteToLocalBook = new Map<string, string>()
        for (const b of allBooks) {
          if (b.remoteId) remoteToLocalBook.set(b.remoteId, b.id)
        }
        for (const remoteId of failedBookIds) {
          const localId = remoteToLocalBook.get(remoteId)
          if (localId) await db.books.update(localId, { updatedAt: bumpedAt })
        }
        for (const id of failedChapterIds) {
          await db.chapters.update(id, { updatedAt: bumpedAt })
        }
        for (const id of failedSectionIds) {
          await db.sections.update(id, { updatedAt: bumpedAt })
        }
        for (const id of failedVocabIds) {
          await db.vocabulary.update(id, { updatedAt: bumpedAt })
        }

        this.log('sync:partial', `${failedCount} entit${failedCount === 1 ? 'y' : 'ies'} failed — re-queued for next sync (books:${failedBookIds.length} chapters:${failedChapterIds.length} sections:${failedSectionIds.length} vocab:${failedVocabIds.length})`)
      }

      // Guard against timestamp regression: only update if the new syncedAt is newer.
      // Also stall LAST_SYNCED_KEY when any cloud-only book failed to download — the
      // failed remoteIds must remain in `cloudOnlyBooks` on the next sync so the
      // download is retried instead of being silently skipped.
      const prevSyncedAt = localStorage.getItem(LAST_SYNCED_KEY)
      if (failedDownloads.length === 0 && (!prevSyncedAt || new Date(result.syncedAt) >= new Date(prevSyncedAt))) {
        localStorage.setItem(LAST_SYNCED_KEY, result.syncedAt)
      }
      this.log('sync:complete', `synced at ${result.syncedAt}`)
      if (failedDownloads.length > 0) {
        const n = failedDownloads.length
        const titles = failedDownloads.slice(0, 3).map(f => `"${f.title}"`).join(', ')
        const more = n > 3 ? ` and ${n - 3} more` : ''
        const dlMsg = `${n} book${n === 1 ? '' : 's'} failed to download (${titles}${more}) — will retry next sync`
        if (failedCount > 0) {
          this.emitStatus('error', `:sync partial — ${failedCount} item${failedCount === 1 ? '' : 's'} will retry; ${dlMsg}`)
        } else {
          this.emitStatus('error', `:sync partial — ${dlMsg}`)
        }
        this.log('sync:download-partial', dlMsg)
      } else if (failedCount > 0) {
        this.emitStatus('error', `:sync partial — ${failedCount} item${failedCount === 1 ? '' : 's'} will retry`)
      } else {
        this.emitStatus('complete', ':sync complete')
      }

      // Notify listeners (e.g. useBooks) that sync finished so they can refresh
      window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
    } catch (err) {
      // Silently ignore aborted requests (from destroy() cancelling in-flight syncs)
      if (err instanceof DOMException && err.name === 'AbortError') {
        this.log('sync:aborted', 'sync cancelled by destroy()')
        return
      }
      console.error('[sync] error:', err)
      this.emitStatus('error', ':sync failed')
    } finally {
      this.isSyncing = false
    }
  }

  // ── Force upload: override cloud with local ──────────────────

  async forceUpload(): Promise<void> {
    // Reset lastSyncedAt to epoch so ALL local entities are sent
    localStorage.setItem(LAST_SYNCED_KEY, '1970-01-01T00:00:00.000Z')
    await this.sync()
  }

  // ── Download from cloud: pull all server data ────────────────

  async downloadFromCloud(): Promise<{ booksDownloaded: number }> {
    const token = await this.getToken()
    if (!token) return { booksDownloaded: 0 }

    // This bootstrap is the loudest resurrection path (it re-adds every active
    // server vocab row), so settle any parked deletes first (KAN-283).
    await this.drainVocabDeletes(token)

    // Fetch + parse + shape-validate BEFORE touching local IDB. If any of
    // (network, non-2xx, parse, malformed payload) fails we throw with the
    // user's library completely untouched — no recovery path needed.
    const res = await fetch(`${this.getApiUrl()}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        lastSyncedAt: '1970-01-01T00:00:00.000Z',
        changes: { books: [], chapters: [], sections: [], vocabulary: [], settings: null, exerciseProgress: [] },
      }),
    })

    if (!res.ok) throw new Error(`Sync failed: ${res.status}`)

    const result = await res.json()
    const serverBooks = result?.serverChanges?.books
    const serverVocab = result?.serverChanges?.vocabulary
    if (!Array.isArray(serverBooks) || !Array.isArray(serverVocab)) {
      throw new Error('Sync failed: malformed server response')
    }
    const activeBooks = (serverBooks as Record<string, unknown>[]).filter((sb) => !sb.deletedAt)
    // Deletes still queued after the drain above (offline / server down) would
    // otherwise be re-downloaded as active rows — hold them out until they land.
    const stillPendingDeletes = new Set(this.readPendingVocabDeletes())
    const activeVocab = (serverVocab as Record<string, unknown>[]).filter(
      (sv) => !sv.deletedAt && !stillPendingDeletes.has(sv.id as string),
    )

    // Past this point, the cloud payload is valid — commit to replacing local
    // data. Wipe atomically so the four tables can't end up half-cleared.
    await db.transaction('rw', [db.books, db.chapters, db.sections, db.vocabulary], async () => {
      await db.sections.clear()
      await db.chapters.clear()
      await db.vocabulary.clear()
      await db.books.clear()
    })

    // Create local books from cloud (parallel, concurrency of 3)
    const { succeeded: booksDownloaded, failed: failedDownloads } = await this.downloadBooksWithProgress(activeBooks, result.serverChanges, token)

    // Download vocabulary (active rows only — server returns soft-deleted vocab
    // so the incremental sync path can mirror tombstones; bootstrap must skip them)
    let failedVocabCount = 0
    for (const sv of activeVocab) {
      try {
        await db.vocabulary.add({
          id: sv.id as string,
          word: sv.word as string,
          pronunciation: (sv.pronunciation as string) ?? '',
          translation: (sv.translation as string) ?? '',
          targetLanguage: (sv.targetLanguage as string) ?? '',
          contextSentence: (sv.contextSentence as string) ?? '',
          explanation: (sv.explanation as string) ?? null,
          bookTitle: (sv.bookTitle as string) ?? '',
          sectionTitle: (sv.sectionTitle as string) ?? '',
          pageNumber: (sv.page as number) ?? 0,
          bookId: sv.bookId as string,
          reviewCount: (sv.reviewCount as number) ?? 0,
          lastReviewedAt: sv.lastReviewedAt ? new Date(sv.lastReviewedAt as string).getTime() : null,
          createdAt: sv.createdAt ? new Date(sv.createdAt as string).getTime() : Date.now(),
          updatedAt: new Date(sv.updatedAt as string).getTime(),
        } as VocabEntry)
      } catch (err) {
        failedVocabCount++
        console.warn('Skipped vocab entry on bootstrap:', sv.word, err)
      }
    }

    // Stall LAST_SYNCED_KEY if anything failed — every failed entity has an
    // updatedAt before result.syncedAt, so advancing the watermark would make
    // them invisible to future incremental syncs. Mirrors the same guard in
    // sync() at lines 517-524.
    if (failedDownloads.length === 0 && failedVocabCount === 0) {
      localStorage.setItem(LAST_SYNCED_KEY, result.syncedAt)
    }

    if (failedDownloads.length > 0 || failedVocabCount > 0) {
      const n = failedDownloads.length
      const titles = failedDownloads.slice(0, 3).map(f => `"${f.title}"`).join(', ')
      const more = n > 3 ? ` and ${n - 3} more` : ''
      const parts: string[] = []
      if (n > 0) parts.push(`${n} book${n === 1 ? '' : 's'} failed (${titles}${more})`)
      if (failedVocabCount > 0) parts.push(`${failedVocabCount} vocab entr${failedVocabCount === 1 ? 'y' : 'ies'} failed`)
      const detail = parts.join('; ')
      this.log('sync:download-partial', detail)
      this.emitStatus('error', `:download partial — ${detail} — try Download again`)
    }

    return { booksDownloaded }
  }

  // ── Download books with progress and concurrency ──────────────

  private async downloadBooksWithProgress(
    books: Record<string, unknown>[],
    serverChanges: { chapters?: Record<string, unknown>[]; sections?: Record<string, unknown>[] },
    token: string,
    signal?: AbortSignal,
  ): Promise<{ succeeded: number; failed: Array<{ remoteId: string; title: string }> }> {
    const total = books.length
    if (total === 0) return { succeeded: 0, failed: [] }

    let processed = 0
    let succeeded = 0
    const failed: Array<{ remoteId: string; title: string }> = []
    const CONCURRENCY = 3

    this.emitStatus('syncing', `:pull 0/${total} books`, { current: 0, total })

    // Process in batches of CONCURRENCY
    for (let i = 0; i < total; i += CONCURRENCY) {
      const batch = books.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (sb) => {
          const remoteId = sb.id as string
          this.log('sync:download', `"${sb.customTitle || remoteId}"`)
          await this.createLocalBookFromServer(sb, serverChanges, token, signal)
        }),
      )

      for (let j = 0; j < results.length; j++) {
        processed++
        const sb = batch[j]
        const result = results[j]
        const title = (sb.customTitle as string) || 'book'
        if (result.status === 'rejected') {
          this.log('sync:download-error', `${sb.id}: ${result.reason}`)
          failed.push({ remoteId: sb.id as string, title })
        } else {
          succeeded++
        }
        this.emitStatus('syncing', `:pull "${title}" (${processed}/${total})`, { current: processed, total })
      }
    }

    return { succeeded, failed }
  }

  // ── Create a local book from server data ──────────────────────

  private async createLocalBookFromServer(
    sb: Record<string, unknown>,
    serverChanges: { chapters?: Record<string, unknown>[]; sections?: Record<string, unknown>[] },
    token: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const remoteId = sb.id as string

    // Fetch catalog first — we need `format` to decide whether to download
    // the source file. EPUBs skip the blob entirely; their text lives in sections.
    let title = (sb.customTitle as string) || 'Untitled'
    let author = ''
    let format: 'pdf' | 'epub' = 'pdf'
    let catalogCoverUrl: string | null = null
    try {
      const summaryRes = await fetch(`${this.getApiUrl()}/books/${remoteId}/summary`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        title = summary.catalog?.title || title
        author = summary.catalog?.author || ''
        if (summary.catalog?.format === 'epub') format = 'epub'
        catalogCoverUrl = summary.catalog?.coverUrl ?? null
      }
    } catch { /* use defaults */ }

    // PDFs: download the blob so the viewer can render offline. EPUBs don't
    // need the source file locally — all text already lives in sections.
    let pdfBlob: Blob | undefined
    let coverImage: string | null = catalogCoverUrl
    if (format === 'pdf') {
      pdfBlob = await this.downloadPdfWithRetry(remoteId, signal)
      if (!coverImage) {
        try {
          const { PDFService } = await import('./pdf-service')
          const pdfSvc = new PDFService()
          coverImage = await pdfSvc.renderPageToImage(pdfBlob, 1, 1.5)
        } catch { /* no cover, that's fine */ }
      }
    }

    // Final guard before touching IndexedDB: if the sync was destroyed while the
    // summary/blob fetches were in flight (and an AbortError was swallowed by the
    // summary try/catch, or the book is an EPUB with no blob download), do NOT
    // write this book — a post-destroy write can leak the prior user's book into
    // the next session after clearLocalSyncState().
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')

    const localId = uuid()
    const now = Date.now()
    await db.books.add({
      id: localId,
      title,
      author,
      totalPages: (sb.totalPages as number) ?? 0,
      format,
      pdfBlob,
      coverImage,
      structureSource: (sb.structureSource as Book['structureSource']) || 'native',
      processingStatus: (sb.processingStatus as Book['processingStatus']) || 'complete',
      createdAt: sb.createdAt ? new Date(sb.createdAt as string).getTime() : now,
      updatedAt: now,
      lastReadAt: sb.lastReadAt ? new Date(sb.lastReadAt as string).getTime() : null,
      lastAccessedSectionId: (sb.lastAccessedSectionId as string) ?? null,
      lastAccessedScrollProgress: sb.lastAccessedScrollProgress != null
        ? (sb.lastAccessedScrollProgress as number) * 100 // 0-1 → 0-100
        : null,
      lastAccessedWordIndex: (sb.lastAccessedWordIndex as number) ?? null,
      completedAt: sb.completedAt ? new Date(sb.completedAt as string).getTime() : null,
      remoteId,
      catalogId: sb.catalogId as string,
    })

    // Create chapters (skip soft-deleted — see vocab note above)
    const serverChapters = (serverChanges.chapters ?? []).filter(
      (ch: Record<string, unknown>) => ch.bookId === remoteId && !ch.deletedAt
    )
    for (const sch of serverChapters) {
      // A row with this server-assigned id may already exist (re-run download,
      // concurrent tab, or the vocab-add syncNow carve-out racing this download).
      // A ConstraintError is benign — same row, same desired end state. Swallow it
      // so one duplicate id doesn't abort the whole book's structure download.
      await db.chapters.add({
        id: sch.id as string,
        bookId: localId,
        title: (sch.title as string) || '',
        order: (sch.sortOrder as number) ?? 0,
        startPage: (sch.startPage as number) ?? 0,
        endPage: (sch.endPage as number) ?? 0,
        updatedAt: now,
      }).catch((err: { name?: string }) => {
        if (err?.name !== 'ConstraintError') throw err
        console.warn('Skipped duplicate chapter during download:', sch.id, err)
      })
    }

    // Create sections (skip soft-deleted — see vocab note above)
    const serverSections = (serverChanges.sections ?? []).filter(
      (sec: Record<string, unknown>) => sec.bookId === remoteId && !sec.deletedAt
    )
    for (const ss of serverSections) {
      // ConstraintError swallowed for the same duplicate-id reason as the chapter
      // loop above — keep the download resilient instead of aborting the book.
      await db.sections.add({
        id: ss.id as string,
        chapterId: ss.chapterId as string,
        bookId: localId,
        title: (ss.title as string) || '',
        order: (ss.sortOrder as number) ?? 0,
        startPage: (ss.startPage as number) ?? 0,
        endPage: (ss.endPage as number) ?? 0,
        extractedText: (ss.extractedText as string) ?? null,
        richContent: (ss.richContent as string) ?? null,
        isRead: (ss.isRead as boolean) ?? false,
        readAt: ss.readAt ? new Date(ss.readAt as string).getTime() : null,
        lastPageViewed: (ss.lastPageViewed as number) ?? null,
        scrollProgress: ((ss.scrollProgress as number) ?? 0) * 100,
        updatedAt: now,
      }).catch((err: { name?: string }) => {
        if (err?.name !== 'ConstraintError') throw err
        console.warn('Skipped duplicate section during download:', ss.id, err)
      })
    }

    return localId
  }

  // ── Best-effort sync on tab close ────────────────────────────

  private flushSync() {
    const token = this.token
    if (!token) return
    const lastSyncedAt = localStorage.getItem(LAST_SYNCED_KEY) || '1970-01-01T00:00:00.000Z'
    try {
      fetch(`${this.getApiUrl()}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lastSyncedAt,
          changes: { books: [], chapters: [], sections: [], vocabulary: [], settings: null, exerciseProgress: [] },
        }),
        keepalive: true,
      })
    } catch {
      // best effort
    }
  }

  // ── Transforms: Local → Backend ──────────────────────────────

  private bookToSync(book: Book): Record<string, unknown> {
    // structureSource and processingStatus are backend-managed — the server rejects
    // client writes on these, and they already flow server→client via applyServerChanges.
    return {
      id: book.remoteId,
      customTitle: book.title,
      coverUrl: book.coverImage ?? null,
      lastReadAt: book.lastReadAt ? new Date(book.lastReadAt).toISOString() : null,
      lastAccessedSectionId: book.lastAccessedSectionId ?? null,
      lastAccessedScrollProgress: (book.lastAccessedScrollProgress ?? 0) / 100, // 0-100 → 0-1
      lastAccessedWordIndex: book.lastAccessedWordIndex ?? null,
      updatedAt: new Date(book.updatedAt).toISOString(),
    }
  }

  private chapterToSync(ch: Chapter, bookMap: Map<string, string>): Record<string, unknown> {
    return {
      id: ch.id,
      bookId: bookMap.get(ch.bookId),
      title: ch.title,
      startPage: ch.startPage ?? null,
      endPage: ch.endPage ?? null,
      sortOrder: ch.order,
      updatedAt: new Date(ch.updatedAt).toISOString(),
    }
  }

  private sectionToSync(sec: Section, bookMap: Map<string, string>): Record<string, unknown> {
    return {
      id: sec.id,
      bookId: bookMap.get(sec.bookId),
      chapterId: sec.chapterId,
      title: sec.title,
      startPage: sec.startPage ?? null,
      endPage: sec.endPage ?? null,
      isRead: sec.isRead,
      readAt: sec.readAt ? new Date(sec.readAt).toISOString() : null,
      lastPageViewed: sec.lastPageViewed ?? null,
      scrollProgress: (sec.scrollProgress ?? 0) / 100, // 0-100 → 0-1
      sortOrder: sec.order,
      sectionType: 'content',
      extractedText: sec.extractedText ?? null,
      updatedAt: new Date(sec.updatedAt).toISOString(),
    }
  }

  private vocabToSync(v: VocabEntry, bookMap: Map<string, string>): Record<string, unknown> {
    return {
      id: v.id,
      bookId: v.bookId ? bookMap.get(v.bookId) ?? null : null,
      word: v.word,
      pronunciation: v.pronunciation ?? null,
      translation: v.translation ?? null,
      targetLanguage: v.targetLanguage ?? null,
      contextSentence: v.contextSentence ?? null,
      explanation: v.explanation ?? null,
      bookTitle: v.bookTitle ?? null,
      sectionTitle: v.sectionTitle ?? null,
      page: v.pageNumber ?? null,
      reviewCount: v.reviewCount ?? 0,
      lastReviewedAt: v.lastReviewedAt ? new Date(v.lastReviewedAt).toISOString() : null,
      updatedAt: new Date(v.updatedAt).toISOString(),
    }
  }

  // ── Apply server changes to existing local entities ──────────

  private async applyServerChanges(
    serverChanges: {
      books?: Record<string, unknown>[]
      chapters?: Record<string, unknown>[]
      sections?: Record<string, unknown>[]
      vocabulary?: Record<string, unknown>[]
    },
    bookRemoteIdMap: Map<string, string>,
  ) {
    const remoteToLocal = new Map<string, string>()
    for (const [localId, remoteId] of bookRemoteIdMap) {
      remoteToLocal.set(remoteId, localId)
    }

    // Update existing books
    for (const sb of serverChanges.books ?? []) {
      const localId = remoteToLocal.get(sb.id as string)
      if (!localId) continue
      const local = await db.books.get(localId)
      if (!local) continue
      const serverUpdated = new Date(sb.updatedAt as string).getTime()
      // Always update processingStatus from server (processing → complete transition)
      const serverProcessingStatus = sb.processingStatus as Book['processingStatus'] | undefined
      if (serverProcessingStatus === 'complete' && local.processingStatus === 'processing') {
        await db.books.update(localId, { processingStatus: 'complete', updatedAt: serverUpdated })
      }
      if (serverUpdated > local.updatedAt) {
        await db.books.update(localId, {
          title: (sb.customTitle as string) || local.title,
          coverImage: (sb.coverUrl as string) || local.coverImage,
          structureSource: (sb.structureSource as Book['structureSource']) || local.structureSource,
          processingStatus: (sb.processingStatus as Book['processingStatus']) || local.processingStatus,
          lastReadAt: sb.lastReadAt ? new Date(sb.lastReadAt as string).getTime() : local.lastReadAt,
          lastAccessedSectionId: (sb.lastAccessedSectionId as string) ?? local.lastAccessedSectionId,
          lastAccessedScrollProgress: sb.lastAccessedScrollProgress != null
            ? (sb.lastAccessedScrollProgress as number) * 100 // 0-1 → 0-100
            : local.lastAccessedScrollProgress,
          lastAccessedWordIndex: (sb.lastAccessedWordIndex as number) ?? local.lastAccessedWordIndex,
          updatedAt: serverUpdated,
        })
      }
    }

    // Update/create/delete chapters
    for (const sch of serverChanges.chapters ?? []) {
      const chapterId = sch.id as string
      if (sch.deletedAt) {
        // Cascade-delete sections so the chapter doesn't leave orphaned rows in the accordion
        await db.sections.where('chapterId').equals(chapterId).delete()
        await db.chapters.delete(chapterId)
        continue
      }
      const remoteBookId = sch.bookId as string
      const localBookId = remoteToLocal.get(remoteBookId)
      if (!localBookId) continue
      const local = await db.chapters.get(chapterId)
      if (!local) {
        // A concurrent writer (other tab, or the vocab-add carve-out racing the
        // debounced sync) can insert the same id between the get() and the add().
        // A ConstraintError here is benign — same row, same desired end state.
        // Swallow it and continue so LAST_SYNCED_KEY can still advance and we
        // don't get stuck replaying this serverChanges window forever.
        await db.chapters.add({
          id: chapterId,
          bookId: localBookId,
          title: (sch.title as string) || '',
          order: (sch.sortOrder as number) ?? 0,
          startPage: (sch.startPage as number) ?? 0,
          endPage: (sch.endPage as number) ?? 0,
          updatedAt: Date.now(),
        }).catch((err: { name?: string }) => {
          if (err?.name !== 'ConstraintError') throw err
          console.warn('Skipped duplicate chapter during sync apply:', chapterId, err)
        })
      } else {
        const serverUpdated = new Date(sch.updatedAt as string).getTime()
        if (serverUpdated > local.updatedAt) {
          await db.chapters.update(chapterId, {
            title: (sch.title as string) || local.title,
            order: (sch.sortOrder as number) ?? local.order,
            startPage: (sch.startPage as number) ?? local.startPage,
            endPage: (sch.endPage as number) ?? local.endPage,
            updatedAt: serverUpdated,
          })
        }
      }
    }

    // Update/create/delete sections
    for (const ss of serverChanges.sections ?? []) {
      if (ss.deletedAt) {
        await db.sections.delete(ss.id as string)
        continue
      }
      const remoteBookId = ss.bookId as string
      const localBookId = remoteToLocal.get(remoteBookId)
      const local = await db.sections.get(ss.id as string)
      if (!local && localBookId) {
        // Create new section from server. ConstraintError swallowed for the same
        // concurrent-writer reason as the chapter branch above.
        await db.sections.add({
          id: ss.id as string,
          chapterId: ss.chapterId as string,
          bookId: localBookId,
          title: (ss.title as string) || '',
          order: (ss.sortOrder as number) ?? 0,
          startPage: (ss.startPage as number) ?? 0,
          endPage: (ss.endPage as number) ?? 0,
          extractedText: (ss.extractedText as string) ?? null,
          richContent: (ss.richContent as string) ?? null,
          isRead: (ss.isRead as boolean) ?? false,
          readAt: ss.readAt ? new Date(ss.readAt as string).getTime() : null,
          lastPageViewed: (ss.lastPageViewed as number) ?? null,
          scrollProgress: ((ss.scrollProgress as number) ?? 0) * 100,
          updatedAt: Date.now(),
        }).catch((err: { name?: string }) => {
          if (err?.name !== 'ConstraintError') throw err
          console.warn('Skipped duplicate section during sync apply:', ss.id, err)
        })
      } else if (local) {
        // Update existing section (reading progress merge)
        const serverUpdated = new Date(ss.updatedAt as string).getTime()
        if (serverUpdated > local.updatedAt) {
          await db.sections.update(ss.id as string, {
            // Server row is authoritatively newer (gated above), so read-state is
            // last-write-wins — NOT monotonic. A previous `server || local` OR
            // meant a newer isRead:false could never win (false||true=true),
            // stranding the "Mark as Unread" toolbar action across devices (KAN-240).
            // readAt likewise clears to null when the server cleared it.
            isRead: ss.isRead as boolean,
            readAt: ss.readAt ? new Date(ss.readAt as string).getTime() : null,
            scrollProgress: Math.max(
              local.scrollProgress ?? 0,
              ((ss.scrollProgress as number) ?? 0) * 100,
            ),
            lastPageViewed: (ss.lastPageViewed as number) ?? local.lastPageViewed,
            extractedText: (ss.extractedText as string) ?? local.extractedText,
            richContent: (ss.richContent as string) ?? local.richContent,
            updatedAt: serverUpdated,
          })
        }
      }
    }

    // Update/create/delete vocabulary
    // A delete whose backend call has not settled yet leaves the server row
    // ACTIVE, so re-adding it below is exactly the resurrection KAN-283
    // describes. Skip those ids until drainVocabDeletes() clears them.
    const pendingVocabDeletes = new Set(this.readPendingVocabDeletes())
    for (const sv of serverChanges.vocabulary ?? []) {
      if (sv.deletedAt) {
        await db.vocabulary.delete(sv.id as string)
        continue
      }
      if (pendingVocabDeletes.has(sv.id as string)) continue
      // Mirror chapter/section pattern: server sends bookId as the server uuid;
      // map it to the local uuid so future where('bookId').equals(localId)
      // queries (e.g. BookRepository.delete cascade) match on this device.
      // If the parent book was just locally deleted in the same sync cycle,
      // remoteToLocal won't have it — skip the insert so vocab orphans from
      // a soft-deleted server book don't resurrect here.
      const remoteBookId = sv.bookId as string | undefined
      const localBookId = remoteBookId ? remoteToLocal.get(remoteBookId) : undefined
      if (remoteBookId && !localBookId) continue
      const local = await db.vocabulary.get(sv.id as string)
      if (!local) {
        // Vocab is the carve-out that bypasses the 30s debounce (see
        // VocabService.add), making the cross-tab race here the most likely
        // ConstraintError source. Swallow and continue.
        await db.vocabulary.add({
          id: sv.id as string,
          word: sv.word as string,
          pronunciation: (sv.pronunciation as string) ?? '',
          translation: (sv.translation as string) ?? '',
          targetLanguage: (sv.targetLanguage as string) ?? '',
          contextSentence: (sv.contextSentence as string) ?? '',
          explanation: (sv.explanation as string) ?? null,
          bookTitle: (sv.bookTitle as string) ?? '',
          sectionTitle: (sv.sectionTitle as string) ?? '',
          pageNumber: (sv.page as number) ?? 0,
          bookId: localBookId,
          reviewCount: (sv.reviewCount as number) ?? 0,
          lastReviewedAt: sv.lastReviewedAt ? new Date(sv.lastReviewedAt as string).getTime() : null,
          createdAt: sv.createdAt ? new Date(sv.createdAt as string).getTime() : Date.now(),
          updatedAt: new Date(sv.updatedAt as string).getTime(),
        } as VocabEntry).catch((err: { name?: string }) => {
          if (err?.name !== 'ConstraintError') throw err
          console.warn('Skipped duplicate vocab entry during sync apply:', sv.id, err)
        })
      } else {
        const serverUpdated = new Date(sv.updatedAt as string).getTime()
        if (serverUpdated > local.updatedAt) {
          // Server row is authoritatively newer (gated above), so content fields
          // are last-write-wins — same rationale as the sections merge (KAN-240).
          // Previously only reviewCount/lastReviewedAt were merged, so any content
          // edited on another device (translation, and especially the AI
          // `explanation` KAN-258 pushes) was silently dropped on pull (KAN-264).
          // Map the same fields the INSERT branch above populates. reviewCount
          // stays monotonic via Math.max; bookId is left as the already-remapped
          // local value (the remoteToLocal skip caveat is handled above).
          await db.vocabulary.update(sv.id as string, {
            word: (sv.word as string) || local.word,
            pronunciation: (sv.pronunciation as string) ?? local.pronunciation,
            translation: (sv.translation as string) ?? local.translation,
            targetLanguage: (sv.targetLanguage as string) ?? local.targetLanguage,
            contextSentence: (sv.contextSentence as string) ?? local.contextSentence,
            explanation: (sv.explanation as string) ?? local.explanation,
            bookTitle: (sv.bookTitle as string) ?? local.bookTitle,
            sectionTitle: (sv.sectionTitle as string) ?? local.sectionTitle,
            pageNumber: (sv.page as number) ?? local.pageNumber,
            reviewCount: Math.max(local.reviewCount ?? 0, (sv.reviewCount as number) ?? 0),
            lastReviewedAt: sv.lastReviewedAt ? new Date(sv.lastReviewedAt as string).getTime() : local.lastReviewedAt,
            updatedAt: serverUpdated,
          })
        }
      }
    }
  }
}

export const syncService = new SyncService()
