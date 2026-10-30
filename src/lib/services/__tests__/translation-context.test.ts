import { describe, it, expect } from 'vitest'
import { NibPage } from '@/lib/nib'
import {
  windowAround,
  translationContext,
  MAX_SENTENCE_CHARS,
  MAX_PARAGRAPH_CONTEXT_CHARS,
} from '../translation-context'

// KAN-374: the text view sent the whole paragraph as paragraphContext and the
// whole sentence as `sentence`, so any paragraph over 5000 chars (or sentence
// over 2000) 400'd on every lookup inside it.

/** One paragraph whose sentences are the given word lists. */
function paragraph(sentences: string[][]) {
  return new NibPage({
    pageNumber: 1,
    header: null,
    footer: null,
    footnotes: [],
    paragraphs: [{
      index: 0,
      sentences: sentences.map((words, index) => ({ index, words: words.map((text, i) => ({ text, index: i })) })),
    }],
    figures: [],
    listItems: [],
  }).paragraphs[0]
}

/** A sentence of `n` distinct 9-char words (10 chars each with the joining space). */
function sentenceWords(tag: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${tag}${String(i).padStart(9 - tag.length, '0')}`)
}

describe('windowAround', () => {
  it('returns input that already fits unchanged', () => {
    expect(windowAround(['a', 'b', 'c'], 1, 100)).toBe('a b c')
  })

  it('keeps the target and grows outward within the budget', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item${String(i).padStart(5, '0')}`) // 9 chars
    const out = windowAround(items, 40, 99)
    expect(out.length).toBeLessThanOrEqual(99)
    expect(out.split(' ')).toContain('item00040')
    // Contiguous run around the target: 10 items of 9 chars + 9 spaces = 99.
    expect(out.split(' ')).toHaveLength(10)
  })

  it('cuts an oversized target to the budget', () => {
    expect(windowAround(['x'.repeat(30), 'y'], 0, 10)).toBe('x'.repeat(10))
  })
})

describe('translationContext', () => {
  it('sends a short paragraph byte-identical to before the fix', () => {
    const p = paragraph([['Hello', 'world.'], ['Second', 'one.']])
    const word = p.sentences[1].words[0]
    expect(translationContext(word)).toEqual({ sentence: 'Second one.', paragraph: 'Hello world. Second one.' })
  })

  it('caps paragraphContext at 5000 and keeps the target sentence (40 x 200-char sentences)', () => {
    const p = paragraph(Array.from({ length: 40 }, (_, i) => sentenceWords(`s${i}w`, 20)))
    expect(p.text.length).toBeGreaterThan(MAX_PARAGRAPH_CONTEXT_CHARS)
    for (const si of [0, 20, 39]) {
      const word = p.sentences[si].words[5]
      const { sentence, paragraph: ctx } = translationContext(word)
      expect(sentence).toBe(p.sentences[si].text)
      expect(ctx.length).toBeLessThanOrEqual(MAX_PARAGRAPH_CONTEXT_CHARS)
      expect(ctx).toContain(p.sentences[si].text)
    }
  })

  it('clamps a 3000-char sentence to 2000 around the clicked word', () => {
    const p = paragraph([sentenceWords('w', 300)])
    expect(p.sentences[0].text.length).toBeGreaterThan(MAX_SENTENCE_CHARS)
    for (const wi of [0, 150, 299]) {
      const word = p.sentences[0].words[wi]
      const { sentence, paragraph: ctx } = translationContext(word)
      expect(sentence.length).toBeLessThanOrEqual(MAX_SENTENCE_CHARS)
      expect(sentence.split(' ')).toContain(word.text)
      expect(ctx).toBe(sentence)
    }
  })
})
