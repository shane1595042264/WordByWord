import { describe, it, expect } from 'vitest'
import { splitWordsIntoSentences, findSentenceIndex } from '../sentences'

const words = (s: string) => s.split(/\s+/).filter(Boolean)

describe('splitWordsIntoSentences', () => {
  it('returns [] for empty input', () => {
    expect(splitWordsIntoSentences([])).toEqual([])
  })

  it('splits after terminal punctuation when the next word is capitalised', () => {
    const ranges = splitWordsIntoSentences(words('The cat sat. It purred! Did it? Yes.'))
    expect(ranges).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
      { start: 5, end: 7 },
      { start: 7, end: 8 },
    ])
  })

  it('does not split when the next word is lowercase', () => {
    expect(splitWordsIntoSentences(words('version 2.0. was released'))).toEqual([{ start: 0, end: 4 }])
  })

  it('treats known abbreviations as non-terminal (Dr. e.g. etc. Fig. No.)', () => {
    expect(splitWordsIntoSentences(words('Dr. Smith arrived.'))).toEqual([{ start: 0, end: 3 }])
    expect(splitWordsIntoSentences(words('use tools, e.g. Hammers'))).toEqual([{ start: 0, end: 4 }])
    expect(splitWordsIntoSentences(words('apples, pears, etc. Then rest'))).toEqual([{ start: 0, end: 5 }])
    expect(splitWordsIntoSentences(words('see Fig. 3 and Eq. 2'))).toEqual([{ start: 0, end: 6 }])
    expect(splitWordsIntoSentences(words('Item No. 5 shipped'))).toEqual([{ start: 0, end: 4 }])
  })

  it('abbreviation matching is case-sensitive, so a sentence can still end in "no."', () => {
    // "No." is an abbreviation, "no." is the word "no" ending a sentence.
    expect(splitWordsIntoSentences(words('The answer is no. Then leave'))).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 6 },
    ])
  })

  it('handles closing quotes/brackets after the period and opening quotes before the next word', () => {
    expect(splitWordsIntoSentences(words('He said "go." Then left'))).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 5 },
    ])
    expect(splitWordsIntoSentences(words('(see above). Next item'))).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ])
    // Next word opens with a quote → it can start a sentence even though its letter is lowercase-agnostic.
    expect(splitWordsIntoSentences(words('late! "hello there," she said.'))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 5 },
    ])
    // Curly quotes behave like straight ones.
    expect(splitWordsIntoSentences(words('done.” “Start again'))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ])
  })

  it('a digit can start a sentence', () => {
    expect(splitWordsIntoSentences(words('It ended. 3 days passed.'))).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
    ])
  })

  it('a trailing fragment without terminal punctuation is still the last sentence', () => {
    expect(splitWordsIntoSentences(words('First one. Second without end'))).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 5 },
    ])
  })

  it('a single word is a single sentence', () => {
    expect(splitWordsIntoSentences(['Hello'])).toEqual([{ start: 0, end: 1 }])
    expect(splitWordsIntoSentences(['Hello.'])).toEqual([{ start: 0, end: 1 }])
  })

  it('accepts non-ASCII uppercase as a sentence start', () => {
    expect(splitWordsIntoSentences(words('Fin. Élan vital'))).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 3 },
    ])
  })
})

describe('splitWordsIntoSentences with maxChars', () => {
  it('cuts an unpunctuated run so no range joins to more than maxChars', () => {
    // A code listing: ~3,000 chars, no terminal punctuation anywhere.
    const listing = Array.from({ length: 500 }, (_, i) => `tok${i}`)
    const ranges = splitWordsIntoSentences(listing, 1000)
    expect(ranges.length).toBeGreaterThan(1)
    expect(ranges[0].start).toBe(0)
    expect(ranges[ranges.length - 1].end).toBe(listing.length)
    for (let i = 0; i < ranges.length; i++) {
      if (i > 0) expect(ranges[i].start).toBe(ranges[i - 1].end)
      const text = listing.slice(ranges[i].start, ranges[i].end).join(' ')
      expect(text.length).toBeLessThanOrEqual(1000)
      // Greedy: adding the next word would have crossed the cap.
      if (i < ranges.length - 1) expect(text.length + 1 + listing[ranges[i].end].length).toBeGreaterThan(1000)
    }
  })

  it('leaves sentences under the cap exactly as without it', () => {
    const prose = words('The quick brown fox. Jumps over the lazy dog. Dr. Smith arrived late!')
    expect(splitWordsIntoSentences(prose, 1000)).toEqual(splitWordsIntoSentences(prose))
  })

  it('cuts at the cap inside a long sentence and still honours later punctuation', () => {
    // "aaaa bbbb" is 9 chars; with a cap of 9 "cccc" starts a new range.
    expect(splitWordsIntoSentences(['aaaa', 'bbbb', 'cccc.', 'Next', 'one'], 9)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 3 },
      { start: 3, end: 5 },
    ])
  })

  it('a word longer than the cap is its own range', () => {
    expect(splitWordsIntoSentences(['a', 'x'.repeat(20), 'b'], 10)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])
  })
})

describe('findSentenceIndex', () => {
  const ranges = [
    { start: 0, end: 3 },
    { start: 3, end: 5 },
    { start: 5, end: 9 },
  ]

  it('finds the containing range, including boundaries', () => {
    expect(findSentenceIndex(ranges, 0)).toBe(0)
    expect(findSentenceIndex(ranges, 2)).toBe(0)
    expect(findSentenceIndex(ranges, 3)).toBe(1)
    expect(findSentenceIndex(ranges, 4)).toBe(1)
    expect(findSentenceIndex(ranges, 5)).toBe(2)
    expect(findSentenceIndex(ranges, 8)).toBe(2)
  })

  it('returns -1 outside every range or for an empty list', () => {
    expect(findSentenceIndex(ranges, -1)).toBe(-1)
    expect(findSentenceIndex(ranges, 9)).toBe(-1)
    expect(findSentenceIndex([], 0)).toBe(-1)
  })
})
