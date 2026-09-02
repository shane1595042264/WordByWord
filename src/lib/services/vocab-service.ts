import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import type { VocabEntry } from '@/lib/db/models'
import { syncService } from './sync-service'

export class VocabService {
  /** Add a word to the vocabulary book */
  async add(entry: Omit<VocabEntry, 'id' | 'createdAt' | 'reviewCount' | 'lastReviewedAt' | 'updatedAt'>): Promise<string> {
    const id = uuid()
    await db.vocabulary.add({
      ...entry,
      id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reviewCount: 0,
      lastReviewedAt: null,
    })
    // Vocab adds are deliberate, low-frequency user actions — push immediately
    // so the entry shows up in the personal-website knowledge base inside a
    // second instead of waiting for the 30s scroll-progress debounce.
    syncService.syncNow()
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
    // Bump updatedAt so the dirty-window watermark in sync-service picks this
    // edit up, then push immediately — mirrors add(). Without both, an updated
    // explanation would never leave the device.
    await db.vocabulary.update(id, { explanation, updatedAt: Date.now() })
    syncService.syncNow()
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

  /** Delete a vocab entry — local IDB + durable backend soft-delete */
  async delete(id: string): Promise<void> {
    await db.vocabulary.delete(id)

    // The local row is dropped unconditionally — the user wants it gone here.
    // Making the SERVER side stick is syncService's job: this used to be a
    // fire-and-forget DELETE that returned early on an expired session and
    // console.warn'd every other failure, so a transient failure left the
    // server row active and the next download-from-cloud resurrected the word.
    // deleteVocabRemote() parks failures and retries them on every sync tick
    // until the backend settles (KAN-283). It never throws.
    await syncService.deleteVocabRemote(id)
  }

  /** Get total count */
  async count(): Promise<number> {
    return db.vocabulary.count()
  }
}
