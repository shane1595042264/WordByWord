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
  }
}

export const db = new BitByBitDB()
