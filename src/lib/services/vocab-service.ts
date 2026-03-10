import { db } from '@/lib/db/database'
import type { VocabEntry } from '@/lib/db/models'

export class VocabService {
  /** Add a word to the vocabulary book */
  async add(entry: Omit<VocabEntry, 'id' | 'createdAt' | 'reviewCount' | 'lastReviewedAt'>): Promise<string> {
    const id = `vocab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await db.vocabulary.add({
      ...entry,
      id,
      createdAt: Date.now(),
      reviewCount: 0,
      lastReviewedAt: null,
    })
    return id
  }

  /** Check if a word (in context of sentence) already exists in vocab */
  async exists(word: string, contextSentence: string): Promise<boolean> {
    const count = await db.vocabulary
      .where('word')
      .equals(word)
      .filter(v => v.contextSentence === contextSentence)
      .count()
    return count > 0
  }

  /** Get all vocab entries, ordered by most recent first */
  async getAll(): Promise<VocabEntry[]> {
    return db.vocabulary.orderBy('createdAt').reverse().toArray()
  }

  /** Get entries for a specific language */
  async getByLanguage(targetLanguage: string): Promise<VocabEntry[]> {
    return db.vocabulary
      .where('targetLanguage')
      .equals(targetLanguage)
      .reverse()
      .sortBy('createdAt')
  }

  /** Get entries for a specific book */
  async getByBook(bookTitle: string): Promise<VocabEntry[]> {
    return db.vocabulary
      .where('bookTitle')
      .equals(bookTitle)
      .reverse()
      .sortBy('createdAt')
  }

  /** Update the explanation for a vocab entry */
  async updateExplanation(id: string, explanation: string): Promise<void> {
    await db.vocabulary.update(id, { explanation })
  }

  /** Mark a vocab entry as reviewed */
  async markReviewed(id: string): Promise<void> {
    const entry = await db.vocabulary.get(id)
    if (entry) {
      await db.vocabulary.update(id, {
        reviewCount: entry.reviewCount + 1,
        lastReviewedAt: Date.now(),
      })
    }
  }

  /** Delete a vocab entry */
  async delete(id: string): Promise<void> {
    await db.vocabulary.delete(id)
  }

  /** Get total count */
  async count(): Promise<number> {
    return db.vocabulary.count()
  }
}
