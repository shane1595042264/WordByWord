import { v4 as uuid } from 'uuid'
import { db } from '../db/database'
import type { Book, Chapter, Section, VocabEntry } from '../db/models'

const SYNC_DEBOUNCE_MS = 30_000
const LAST_SYNCED_KEY = 'nibble_lastSyncedAt'
const SYNC_LOG_KEY = 'nibble_syncLog'

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

type ConflictResolver = (conflict: SyncConflict) => Promise<'cloud' | 'local' | 'auto'>

class SyncService {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private isSyncing = false
  private token: string | null = null
  private tokenExp = 0
  private cleanupFns: (() => void)[] = []
  private conflictResolver: ConflictResolver | null = null
  private hasInitSynced = false

  // ── Lifecycle ────────────────────────────────────────────────

  /** Register a callback for when sync finds conflicts (used by UI) */
  onConflict(resolver: ConflictResolver) {
    this.conflictResolver = resolver
  }

  init() {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') this.sync()
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibility))

    const onBeforeUnload = () => this.flushSync()
    window.addEventListener('beforeunload', onBeforeUnload)
    this.cleanupFns.push(() => window.removeEventListener('beforeunload', onBeforeUnload))

    // Full sync on init — always sync from epoch on first load to catch all changes
    this.hasInitSynced = false
    this.sync()
  }

  destroy() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.cleanupFns.forEach(fn => fn())
    this.cleanupFns = []
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

  // ── Dirty trigger ────────────────────────────────────────────

  markDirty() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => this.sync(), SYNC_DEBOUNCE_MS)
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

  // ── Book upload ──────────────────────────────────────────────

  async uploadBook(
    file: File | Blob,
    title: string,
    author?: string,
    totalPages?: number,
  ): Promise<{ remoteId: string; catalogId: string; coverUrl?: string } | null> {
    const token = await this.getToken()
    if (!token) return null

    const formData = new FormData()
    formData.append('file', file, `${title}.pdf`)
    formData.append('title', title)
    if (author) formData.append('author', author)
    if (totalPages) formData.append('totalPages', String(totalPages))

    try {
      const res = await fetch(`${this.getApiUrl()}/books/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (!res.ok) {
        console.error('[sync] upload failed:', res.status)
        return null
      }
      const data = await res.json()
      return {
        remoteId: data.book.id,
        catalogId: data.catalogEntry.id,
        coverUrl: data.catalogEntry.coverUrl || undefined,
      }
    } catch (err) {
      console.error('[sync] upload error:', err)
      return null
    }
  }

  // ── Download PDF from cloud ──────────────────────────────────

  private async downloadPdf(remoteBookId: string): Promise<Blob | null> {
    const token = await this.getToken()
    if (!token) return null
    try {
      const res = await fetch(`${this.getApiUrl()}/books/${remoteBookId}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return null
      return await res.blob()
    } catch {
      return null
    }
  }

  // ── Core sync (bidirectional) ────────────────────────────────

  async sync(): Promise<void> {
    if (this.isSyncing) return
    const token = await this.getToken()
    if (!token) return

    this.isSyncing = true
    try {
      // On first sync after init, always sync from epoch to catch everything (deletions, new books)
      const isInitSync = !this.hasInitSynced
      const lastSyncedAt = isInitSync
        ? '1970-01-01T00:00:00.000Z'
        : (localStorage.getItem(LAST_SYNCED_KEY) || '1970-01-01T00:00:00.000Z')
      const sinceMs = new Date(lastSyncedAt).getTime()
      this.hasInitSynced = true

      this.log('sync:start', isInitSync ? 'full sync (init)' : 'incremental')

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
      })

      if (res.status === 401) {
        this.token = null
        this.isSyncing = false
        return this.sync()
      }

      if (!res.ok) {
        this.log('sync:error', `HTTP ${res.status}`)
        return
      }

      const result = await res.json()
      const serverBooks = (result.serverChanges.books ?? []) as Record<string, unknown>[]

      // Detect what the server has
      const existingRemoteIds = new Set(allBooks.map(b => b.remoteId).filter(Boolean))
      const activeServerBooks = serverBooks.filter(sb => !sb.deletedAt)
      const deletedServerBooks = serverBooks.filter(sb => sb.deletedAt)
      const cloudOnlyBooks = activeServerBooks.filter(sb => !existingRemoteIds.has(sb.id as string))
      const localOnlyBooks = allBooks.filter(b => b.remoteId && !serverBooks.some(sb => sb.id === b.remoteId))
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

        // 1. Remove locally any books the server soft-deleted (recency: server delete is newer)
        for (const sb of cloudDeletedBooks) {
          const localBook = allBooks.find(b => b.remoteId === (sb.id as string))
          if (localBook) {
            this.log('sync:delete-local', `"${localBook.title}" deleted on cloud`)
            await db.sections.where('bookId').equals(localBook.id).delete()
            await db.chapters.where('bookId').equals(localBook.id).delete()
            await db.books.delete(localBook.id)
          }
        }

        // 2. Download cloud-only books
        for (const sb of cloudOnlyBooks) {
          const remoteId = sb.id as string
          this.log('sync:download', `"${sb.customTitle || remoteId}"`)
          try {
            await this.createLocalBookFromServer(sb, result.serverChanges, token)
          } catch (err) {
            this.log('sync:download-error', `${remoteId}: ${err}`)
          }
        }
      }

      localStorage.setItem(LAST_SYNCED_KEY, result.syncedAt)
      this.log('sync:complete', `synced at ${result.syncedAt}`)
    } catch (err) {
      console.error('[sync] error:', err)
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

    // Clear ALL local data first — cloud is the source of truth
    await db.sections.clear()
    await db.chapters.clear()
    await db.vocabulary.clear()
    await db.books.clear()

    // Get all server data by syncing from epoch with no local changes
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
    let booksDownloaded = 0

    // Create local books from cloud
    for (const sb of result.serverChanges.books ?? []) {
      if (sb.deletedAt) continue
      try {
        console.log(`[sync] downloading book: ${sb.customTitle || sb.id}...`)
        await this.createLocalBookFromServer(sb, result.serverChanges, token)
        booksDownloaded++
      } catch (err) {
        console.error('[sync] failed to download book:', sb.id, err)
      }
    }

    // Download vocabulary
    for (const sv of result.serverChanges.vocabulary ?? []) {
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
      } as VocabEntry).catch(() => {}) // ignore dupes
    }

    localStorage.setItem(LAST_SYNCED_KEY, result.syncedAt)
    return { booksDownloaded }
  }

  // ── Create a local book from server data ──────────────────────

  private async createLocalBookFromServer(
    sb: Record<string, unknown>,
    serverChanges: { chapters?: Record<string, unknown>[]; sections?: Record<string, unknown>[] },
    token: string,
  ): Promise<string> {
    const remoteId = sb.id as string

    // Download PDF
    const pdfBlob = await this.downloadPdf(remoteId)
    if (!pdfBlob) throw new Error('Failed to download PDF')

    // Get catalog info
    let title = (sb.customTitle as string) || 'Untitled'
    let author = ''
    try {
      const summaryRes = await fetch(`${this.getApiUrl()}/books/${remoteId}/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (summaryRes.ok) {
        const summary = await summaryRes.json()
        title = summary.catalog?.title || title
        author = summary.catalog?.author || ''
      }
    } catch { /* use defaults */ }

    const localId = uuid()
    const now = Date.now()
    await db.books.add({
      id: localId,
      title,
      author,
      totalPages: (sb.totalPages as number) ?? 0,
      pdfBlob,
      coverImage: null,
      structureSource: (sb.structureSource as Book['structureSource']) || 'native',
      processingStatus: (sb.processingStatus as Book['processingStatus']) || 'complete',
      createdAt: sb.createdAt ? new Date(sb.createdAt as string).getTime() : now,
      updatedAt: now,
      lastReadAt: sb.lastReadAt ? new Date(sb.lastReadAt as string).getTime() : null,
      lastAccessedSectionId: (sb.lastAccessedSectionId as string) ?? null,
      lastAccessedScrollProgress: (sb.lastAccessedScrollProgress as number) ?? null,
      lastAccessedWordIndex: (sb.lastAccessedWordIndex as number) ?? null,
      remoteId,
      catalogId: sb.catalogId as string,
    })

    // Create chapters
    const serverChapters = (serverChanges.chapters ?? []).filter(
      (ch: Record<string, unknown>) => ch.bookId === remoteId
    )
    for (const sch of serverChapters) {
      await db.chapters.add({
        id: sch.id as string,
        bookId: localId,
        title: (sch.title as string) || '',
        order: (sch.sortOrder as number) ?? 0,
        startPage: (sch.startPage as number) ?? 0,
        endPage: (sch.endPage as number) ?? 0,
        updatedAt: now,
      })
    }

    // Create sections
    const serverSections = (serverChanges.sections ?? []).filter(
      (sec: Record<string, unknown>) => sec.bookId === remoteId
    )
    for (const ss of serverSections) {
      await db.sections.add({
        id: ss.id as string,
        chapterId: ss.chapterId as string,
        bookId: localId,
        title: (ss.title as string) || '',
        order: (ss.sortOrder as number) ?? 0,
        startPage: (ss.startPage as number) ?? 0,
        endPage: (ss.endPage as number) ?? 0,
        extractedText: (ss.extractedText as string) ?? null,
        isRead: (ss.isRead as boolean) ?? false,
        readAt: ss.readAt ? new Date(ss.readAt as string).getTime() : null,
        lastPageViewed: (ss.lastPageViewed as number) ?? null,
        scrollProgress: ((ss.scrollProgress as number) ?? 0) * 100,
        updatedAt: now,
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
    return {
      id: book.remoteId,
      customTitle: book.title,
      structureSource: book.structureSource,
      processingStatus: book.processingStatus,
      lastReadAt: book.lastReadAt ? new Date(book.lastReadAt).toISOString() : null,
      lastAccessedSectionId: book.lastAccessedSectionId ?? null,
      lastAccessedScrollProgress: book.lastAccessedScrollProgress ?? 0,
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
      if (serverUpdated > local.updatedAt) {
        await db.books.update(localId, {
          title: (sb.customTitle as string) || local.title,
          structureSource: (sb.structureSource as Book['structureSource']) || local.structureSource,
          processingStatus: (sb.processingStatus as Book['processingStatus']) || local.processingStatus,
          lastReadAt: sb.lastReadAt ? new Date(sb.lastReadAt as string).getTime() : local.lastReadAt,
          lastAccessedSectionId: (sb.lastAccessedSectionId as string) ?? local.lastAccessedSectionId,
          lastAccessedScrollProgress: (sb.lastAccessedScrollProgress as number) ?? local.lastAccessedScrollProgress,
          lastAccessedWordIndex: (sb.lastAccessedWordIndex as number) ?? local.lastAccessedWordIndex,
          updatedAt: serverUpdated,
        })
      }
    }

    // Update existing sections (reading progress merge)
    for (const ss of serverChanges.sections ?? []) {
      const local = await db.sections.get(ss.id as string)
      if (!local) continue
      const serverUpdated = new Date(ss.updatedAt as string).getTime()
      if (serverUpdated > local.updatedAt) {
        await db.sections.update(ss.id as string, {
          isRead: (ss.isRead as boolean) || local.isRead,
          readAt: ss.readAt ? new Date(ss.readAt as string).getTime() : local.readAt,
          scrollProgress: Math.max(
            local.scrollProgress ?? 0,
            ((ss.scrollProgress as number) ?? 0) * 100,
          ),
          lastPageViewed: (ss.lastPageViewed as number) ?? local.lastPageViewed,
          updatedAt: serverUpdated,
        })
      }
    }

    // Update/create vocabulary
    for (const sv of serverChanges.vocabulary ?? []) {
      const local = await db.vocabulary.get(sv.id as string)
      if (!local) {
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
      } else {
        const serverUpdated = new Date(sv.updatedAt as string).getTime()
        if (serverUpdated > local.updatedAt) {
          await db.vocabulary.update(sv.id as string, {
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
