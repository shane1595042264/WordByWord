import Dexie, { type Table } from 'dexie'
import type { Book, Chapter, Section, VocabEntry } from './models'

export class BitByBitDB extends Dexie {
  books!: Table<Book, string>
  chapters!: Table<Chapter, string>
  sections!: Table<Section, string>
  vocabulary!: Table<VocabEntry, string>

  constructor() {
    super('BitByBitDB')
    this.version(1).stores({
      books: 'id, title, createdAt, lastReadAt',
      chapters: 'id, bookId, order',
      sections: 'id, chapterId, bookId, order, isRead',
    })
    this.version(2).stores({
      books: 'id, title, createdAt, lastReadAt',
      chapters: 'id, bookId, order',
      sections: 'id, chapterId, bookId, order, isRead',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount',
    })
    this.version(3).stores({
      books: 'id, title, createdAt, lastReadAt',
      chapters: 'id, bookId, order',
      sections: 'id, chapterId, bookId, order, isRead',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount',
    }).upgrade(tx => {
      return tx.table('books').toCollection().modify(book => {
        if (book.lastAccessedSectionId === undefined) book.lastAccessedSectionId = null
        if (book.lastAccessedScrollProgress === undefined) book.lastAccessedScrollProgress = null
        if (book.lastAccessedWordIndex === undefined) book.lastAccessedWordIndex = null
      })
    })
    this.version(4).stores({
      books: 'id, title, createdAt, lastReadAt, updatedAt, remoteId',
      chapters: 'id, bookId, order, updatedAt',
      sections: 'id, chapterId, bookId, order, isRead, updatedAt',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount, updatedAt, bookId',
    }).upgrade(tx => {
      const now = Date.now()
      return Promise.all([
        tx.table('books').toCollection().modify(book => {
          book.updatedAt = book.updatedAt ?? book.createdAt ?? now
        }),
        tx.table('chapters').toCollection().modify(ch => {
          ch.updatedAt = ch.updatedAt ?? now
        }),
        tx.table('sections').toCollection().modify(sec => {
          sec.updatedAt = sec.updatedAt ?? now
        }),
        tx.table('vocabulary').toCollection().modify(v => {
          v.updatedAt = v.updatedAt ?? v.createdAt ?? now
        }),
      ])
    })
    this.version(5).stores({
      books: 'id, title, createdAt, lastReadAt, updatedAt, remoteId, jobId',
      chapters: 'id, bookId, order, updatedAt',
      sections: 'id, chapterId, bookId, order, isRead, updatedAt',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount, updatedAt, bookId',
    })
    this.version(6).stores({
      books: 'id, title, createdAt, lastReadAt, updatedAt, remoteId, jobId, completedAt',
      chapters: 'id, bookId, order, updatedAt',
      sections: 'id, chapterId, bookId, order, isRead, updatedAt',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount, updatedAt, bookId',
    }).upgrade(tx => {
      return tx.table('books').toCollection().modify(book => {
        if (book.completedAt === undefined) book.completedAt = null
      })
    })
    // Index-only progress for the library grid (KAN-420): the two derived fields
    // let getBookProgress read read/scroll state from index keys instead of
    // deserializing every section's extractedText. Booleans and nulls are not
    // valid IndexedDB keys, hence the numeric copies.
    this.version(7).stores({
      books: 'id, title, createdAt, lastReadAt, updatedAt, remoteId, jobId, completedAt',
      chapters: 'id, bookId, order, updatedAt',
      sections: 'id, chapterId, bookId, order, isRead, updatedAt, [bookId+progressRead+progressScroll]',
      vocabulary: 'id, word, targetLanguage, bookTitle, createdAt, reviewCount, updatedAt, bookId',
    }).upgrade(tx => {
      return tx.table('sections').toCollection().modify(sec => {
        Object.assign(sec, sectionProgressFields(sec.isRead, sec.scrollProgress))
      })
    })

    // Keep the derived fields in step with every Dexie write — add, put, bulk*,
    // update and modify all pass through these hooks.
    this.sections.hook('creating', (_key, obj) => {
      Object.assign(obj, sectionProgressFields(obj.isRead, obj.scrollProgress))
    })
    this.sections.hook('updating', (mods: Partial<Section>, _key, obj) => {
      return sectionProgressFields(
        'isRead' in mods ? mods.isRead : obj.isRead,
        'scrollProgress' in mods ? mods.scrollProgress : obj.scrollProgress,
      )
    })
  }
}

export function sectionProgressFields(isRead: unknown, scrollProgress: number | null | undefined) {
  return { progressRead: isRead ? 1 : 0, progressScroll: scrollProgress ?? 0 }
}

export const db = new BitByBitDB()
