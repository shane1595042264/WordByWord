import { db } from '../db/database'
import type { Book, Chapter, Section, VocabEntry } from '../db/models'
import { syncWithServer, type SyncEntity, type SyncPayload, type SyncResponse } from '../api/sync'

const SYNC_KEY = 'nibble_last_synced_at'
const SYNC_INTERVAL = 30_000 // 30 seconds

function getLastSyncedAt(): string {
  return localStorage.getItem(SYNC_KEY) || new Date(0).toISOString()
}

function setLastSyncedAt(ts: string) {
  localStorage.setItem(SYNC_KEY, ts)
}

// Convert local Dexie records to SyncEntities
function toSyncEntity(record: Record<string, any>): SyncEntity {
  return {
    id: record.id,
    ...record,
    updatedAt: record.updatedAt || new Date(record.createdAt || Date.now()).toISOString(),
    deletedAt: record.deletedAt || null,
  }
}

// Collect all local changes since last sync
async function collectLocalChanges(): Promise<SyncPayload['changes']> {
  const lastSync = getLastSyncedAt()

  // For simplicity, send ALL records on each sync
  // In production, track updatedAt per record and filter
  const books = await db.books.toArray()
  const chapters = await db.chapters.toArray()
  const sections = await db.sections.toArray()
  const vocabulary = await db.vocabulary.toArray()

  return {
    books: books.map(b => toSyncEntity({
      id: b.id,
      catalogId: (b as any).catalogId,
      customTitle: b.title,
      coverUrl: b.coverImage,
      structureSource: b.structureSource,
      processingStatus: b.processingStatus,
      lastReadAt: b.lastReadAt ? new Date(b.lastReadAt).toISOString() : null,
      lastAccessedSectionId: b.lastAccessedSectionId,
      lastAccessedScrollProgress: b.lastAccessedScrollProgress,
      lastAccessedWordIndex: b.lastAccessedWordIndex,
      updatedAt: new Date(b.lastReadAt || b.createdAt).toISOString(),
    })),
    chapters: chapters.map(c => toSyncEntity({
      id: c.id,
      bookId: c.bookId,
      title: c.title,
      sortOrder: c.order,
      startPage: c.startPage,
      endPage: c.endPage,
      updatedAt: new Date().toISOString(),
    })),
    sections: sections.map(s => toSyncEntity({
      id: s.id,
      bookId: s.bookId,
      chapterId: s.chapterId,
      title: s.title,
      sortOrder: s.order,
      startPage: s.startPage,
      endPage: s.endPage,
      isRead: s.isRead,
      readAt: s.readAt ? new Date(s.readAt).toISOString() : null,
      lastPageViewed: s.lastPageViewed,
      scrollProgress: s.scrollProgress,
      extractedText: s.extractedText,
      updatedAt: new Date().toISOString(),
    })),
    vocabulary: vocabulary.map(v => toSyncEntity({
      id: v.id,
      word: v.word,
      pronunciation: v.pronunciation,
      translation: v.translation,
      targetLanguage: v.targetLanguage,
      contextSentence: v.contextSentence,
      explanation: v.explanation,
      bookTitle: v.bookTitle,
      sectionTitle: v.sectionTitle,
      page: v.pageNumber,
      reviewCount: v.reviewCount,
      lastReviewedAt: v.lastReviewedAt ? new Date(v.lastReviewedAt).toISOString() : null,
      updatedAt: new Date(v.createdAt).toISOString(),
    })),
    settings: null,
    exerciseProgress: [],
  }
}

// Apply server changes to local IndexedDB
async function applyServerChanges(serverChanges: SyncResponse['serverChanges']) {
  // Books
  for (const book of serverChanges.books) {
    const existing = await db.books.get(book.id)
    if (book.deletedAt) {
      if (existing) await db.books.delete(book.id)
      continue
    }
    // Map from backend schema to frontend model
    const localBook: Partial<Book> = {
      id: book.id,
      title: (book.customTitle as string) || (book as any).title || '',
      coverImage: (book.coverUrl as string) || null,
      structureSource: (book.structureSource as Book['structureSource']) || 'native',
      processingStatus: (book.processingStatus as Book['processingStatus']) || 'pending',
      lastReadAt: book.lastReadAt ? new Date(book.lastReadAt as string).getTime() : null,
      lastAccessedSectionId: (book.lastAccessedSectionId as string) || null,
      lastAccessedScrollProgress: (book.lastAccessedScrollProgress as number) || null,
      lastAccessedWordIndex: (book.lastAccessedWordIndex as number) || null,
    }
    if (existing) {
      await db.books.update(book.id, localBook)
    }
  }

  // Chapters
  for (const ch of serverChanges.chapters) {
    const existing = await db.chapters.get(ch.id)
    if (ch.deletedAt) {
      if (existing) await db.chapters.delete(ch.id)
      continue
    }
    const localChapter: Partial<Chapter> = {
      id: ch.id,
      bookId: ch.bookId as string,
      title: ch.title as string,
      order: (ch.sortOrder as number) || 0,
      startPage: (ch.startPage as number) || 0,
      endPage: (ch.endPage as number) || 0,
    }
    if (existing) {
      await db.chapters.update(ch.id, localChapter)
    } else {
      await db.chapters.add(localChapter as Chapter)
    }
  }

  // Sections
  for (const sec of serverChanges.sections) {
    const existing = await db.sections.get(sec.id)
    if (sec.deletedAt) {
      if (existing) await db.sections.delete(sec.id)
      continue
    }
    const localSection: Partial<Section> = {
      id: sec.id,
      bookId: sec.bookId as string,
      chapterId: sec.chapterId as string,
      title: sec.title as string,
      order: (sec.sortOrder as number) || 0,
      startPage: (sec.startPage as number) || 0,
      endPage: (sec.endPage as number) || 0,
      isRead: (sec.isRead as boolean) || false,
      readAt: sec.readAt ? new Date(sec.readAt as string).getTime() : null,
      lastPageViewed: (sec.lastPageViewed as number) || null,
      scrollProgress: (sec.scrollProgress as number) || null,
      extractedText: (sec.extractedText as string) || null,
    }
    if (existing) {
      await db.sections.update(sec.id, localSection)
    } else {
      await db.sections.add(localSection as Section)
    }
  }

  // Vocabulary
  for (const vocab of serverChanges.vocabulary) {
    const existing = await db.vocabulary.get(vocab.id)
    if (vocab.deletedAt) {
      if (existing) await db.vocabulary.delete(vocab.id)
      continue
    }
    const localVocab: Partial<VocabEntry> = {
      id: vocab.id,
      word: vocab.word as string,
      pronunciation: (vocab.pronunciation as string) || '',
      translation: (vocab.translation as string) || '',
      targetLanguage: (vocab.targetLanguage as string) || '',
      contextSentence: (vocab.contextSentence as string) || '',
      explanation: (vocab.explanation as string) || null,
      bookTitle: (vocab.bookTitle as string) || '',
      sectionTitle: (vocab.sectionTitle as string) || '',
      pageNumber: (vocab.page as number) || 0,
      reviewCount: (vocab.reviewCount as number) || 0,
      lastReviewedAt: vocab.lastReviewedAt ? new Date(vocab.lastReviewedAt as string).getTime() : null,
    }
    if (existing) {
      await db.vocabulary.update(vocab.id, localVocab)
    } else {
      await db.vocabulary.add({
        ...localVocab,
        createdAt: Date.now(),
      } as VocabEntry)
    }
  }
}

// Main sync function
export async function performSync(): Promise<void> {
  try {
    const lastSyncedAt = getLastSyncedAt()
    const changes = await collectLocalChanges()

    const response = await syncWithServer({
      lastSyncedAt,
      changes,
    })

    await applyServerChanges(response.serverChanges)
    setLastSyncedAt(response.syncedAt)

    console.log('Sync completed at', response.syncedAt)
  } catch (error) {
    console.error('Sync failed:', error)
  }
}

// Auto-sync timer
let syncTimer: ReturnType<typeof setInterval> | null = null

export function startAutoSync() {
  if (syncTimer) return
  // Initial sync
  performSync()
  // Periodic sync
  syncTimer = setInterval(performSync, SYNC_INTERVAL)
}

export function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
}
