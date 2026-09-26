import { describe, it, expect, beforeEach, vi } from 'vitest'

// VocabService.add() pushes immediately via syncService; the getter under test
// never touches the network, so stub the module out rather than letting a real
// fetch escape the suite.
vi.mock('../sync-service', () => ({
  syncService: { syncNow: vi.fn(), deleteVocabRemote: vi.fn().mockResolvedValue(undefined) },
}))

import { db } from '@/lib/db/database'
import { VocabService } from '../vocab-service'
import type { VocabEntry } from '@/lib/db/models'

function entry(overrides: Partial<VocabEntry>): VocabEntry {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    word: 'gato',
    pronunciation: 'ˈɡa.to',
    translation: 'cat',
    targetLanguage: 'en',
    contextSentence: 'El gato duerme.',
    explanation: null,
    bookTitle: 'Book',
    sectionTitle: 'Section',
    pageNumber: 1,
    createdAt: Date.now(),
    reviewCount: 0,
    lastReviewedAt: null,
    updatedAt: Date.now(),
    ...overrides,
  }
}

describe('VocabService.findByWordAndContext', () => {
  const svc = new VocabService()

  beforeEach(async () => {
    await db.vocabulary.clear()
  })

  it('returns the stored row so callers can read its cached AI fields', async () => {
    await db.vocabulary.add(entry({ id: 'a', explanation: 'because it is the subject' }))

    const found = await svc.findByWordAndContext('gato', 'El gato duerme.')

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('a')
    expect(found[0].pronunciation).toBe('ˈɡa.to')
    expect(found[0].translation).toBe('cat')
    expect(found[0].explanation).toBe('because it is the subject')
  })

  it('does not match the same word saved from a different sentence', async () => {
    await db.vocabulary.add(entry({ id: 'other', contextSentence: 'Un gato negro.' }))

    expect(await svc.findByWordAndContext('gato', 'El gato duerme.')).toEqual([])
  })

  it('returns every language variant so the caller can pick the displayed one', async () => {
    await db.vocabulary.add(entry({ id: 'en', targetLanguage: 'en', translation: 'cat' }))
    await db.vocabulary.add(entry({ id: 'fr', targetLanguage: 'fr', translation: 'chat' }))

    const found = await svc.findByWordAndContext('gato', 'El gato duerme.')

    expect(found).toHaveLength(2)
    expect(found.find(e => e.targetLanguage === 'fr')?.translation).toBe('chat')
    // Language-agnostic truthiness is what the Add-to-vocab button keys off.
    expect(found.length > 0).toBe(true)
  })

  it('returns an empty array when the word was never saved', async () => {
    expect(await svc.findByWordAndContext('perro', 'El gato duerme.')).toEqual([])
  })
})
