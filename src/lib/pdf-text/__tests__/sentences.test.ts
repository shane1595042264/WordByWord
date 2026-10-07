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
