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
  }
}

export const db = new BitByBitDB()
