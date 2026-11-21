import { describe, it, expect } from 'vitest'
import { NibPage, NibDocument, NibMarkdownParser } from '@/lib/nib'
import {
  windowAround,
  translationContext,
  MAX_SENTENCE_CHARS,
  MAX_PARAGRAPH_CONTEXT_CHARS,
  MAX_VOCAB_CONTEXT_CHARS,
  vocabContextSentence,
  capVocabContext,
  explainTranslationWord,
  capExplainContent,
  MAX_EXPLAIN_WORD_CHARS,
  MAX_EXPLAIN_CONTENT_CHARS,
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

// KAN-377: Add to Vocabulary stored the whole sentence as contextSentence, and
// /sync rejects one over 2000 chars, so the row re-queued on every sync forever.
describe('vocabContextSentence', () => {
  it('keeps a sentence within the bound byte-identical', () => {
    const p = paragraph([['Hello', 'world.']])
    expect(vocabContextSentence(p.sentences[0].words[1])).toBe(p.sentences[0].text)
  })

  it('windows a 2,500-char sentence to the bound, around the clicked word', () => {
    const words = sentenceWords('v', 250)
    const p = paragraph([words])
    expect(p.sentences[0].text.length).toBeGreaterThan(MAX_VOCAB_CONTEXT_CHARS)
    for (const i of [0, 125, 249]) {
      const out = vocabContextSentence(p.sentences[0].words[i])
      expect(out.length).toBeLessThanOrEqual(MAX_VOCAB_CONTEXT_CHARS)
      expect(out.split(' ')).toContain(words[i])
    }
  })
})

describe('capVocabContext', () => {
  it('leaves a context within the bound unchanged', () => {
    expect(capVocabContext('El gato duerme.', 'gato')).toBe('El gato duerme.')
  })

  it('caps a stored 3,000-char context around the word', () => {
    const words = sentenceWords('c', 300)
    const text = words.join(' ')
    const out = capVocabContext(text, words[280])
    expect(out.length).toBeLessThanOrEqual(MAX_VOCAB_CONTEXT_CHARS)
    expect(out.split(' ')).toContain(words[280])
  })

  it('falls back to the start when the word is not in the context', () => {
    const out = capVocabContext('x'.repeat(3000), 'missing')
    expect(out).toBe('x'.repeat(MAX_VOCAB_CONTEXT_CHARS))
  })
})

// KAN-415: every math token carried its whole equation as latexSource and a
// [Table]/[Code] word its whole block, all sent uncut, so long ones 400'd.

function parsedParagraphs(markdown: string) {
  return new NibDocument(new NibMarkdownParser().parse(markdown, 'T', 'A')).pages[0].paragraphs
}

/** A display equation of `n` distinct terms, ~10 chars each. */
function longEquation(n: number): string {
  return Array.from({ length: n }, (_, i) => `x_{${String(i).padStart(3, '0')}}`).join(' + ')
}

describe('explainTranslationWord', () => {
  it('sends a plain word as its text', () => {
    const word = parsedParagraphs('Hello world.')[0].sentences[0].words[1]
    expect(explainTranslationWord(word)).toBe('world.')
  })

  it('sends a short equation whole, as before the fix', () => {
    const word = parsedParagraphs('$$a^2 + b^2 = c^2$$')[0].sentences[0].words[2]
    expect(explainTranslationWord(word)).toBe('a^2 + b^2 = c^2')
  })

  it('windows a 600-char display equation around the clicked token', () => {
    const latex = longEquation(61)
    expect(latex.length).toBeGreaterThan(600)
    const words = parsedParagraphs(`$$${latex}$$`)[0].sentences[0].words
    const word = words[words.length - 3]
    const out = explainTranslationWord(word)
    expect(out.length).toBeLessThanOrEqual(MAX_EXPLAIN_WORD_CHARS)
    expect(out.length).toBeGreaterThan(MAX_EXPLAIN_WORD_CHARS / 2)
    expect(out).toContain(word.text)
  })

  it('windows only the clicked inline equation, not the prose around it', () => {
    const latex = longEquation(30)
    const words = parsedParagraphs(`Before $${latex}$ after.`)[0].sentences[0].words
    const out = explainTranslationWord(words[5])
    expect(out.length).toBeLessThanOrEqual(MAX_EXPLAIN_WORD_CHARS)
    expect(out).not.toContain('Before')
    expect(out).not.toContain('after.')
  })
})

describe('capExplainContent', () => {
  it('returns content within the cap unchanged', () => {
    const table = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')
    expect(capExplainContent(table)).toBe(table)
  })

  it('cuts a 15,000-char table at a row boundary and marks the cut', () => {
    const rows = ['| h1 | h2 |', '|---|---|', ...Array.from({ length: 1200 }, (_, i) => `| r${i} | v${i} |`)]
    const table = rows.join('\n')
    expect(table.length).toBeGreaterThan(15000)
    const out = capExplainContent(table)
    expect(out.length).toBeLessThanOrEqual(MAX_EXPLAIN_CONTENT_CHARS)
    const lines = out.split('\n')
    expect(lines.slice(0, 2)).toEqual(['| h1 | h2 |', '|---|---|'])
    expect(lines.slice(0, -1).every(row => rows.includes(row))).toBe(true)
    expect(out.endsWith('(truncated)')).toBe(true)
  })

  it('caps the [Table] word the parser builds', () => {
    const rows = ['| h1 | h2 |', '|---|---|', ...Array.from({ length: 1200 }, (_, i) => `| r${i} | v${i} |`)]
    const word = parsedParagraphs(rows.join('\n'))[0].sentences[0].words[0]
    expect(word.text).toBe('[Table]')
    expect(word.latexSource!.length).toBeGreaterThan(MAX_EXPLAIN_CONTENT_CHARS)
    expect(capExplainContent(word.latexSource!).length).toBeLessThanOrEqual(MAX_EXPLAIN_CONTENT_CHARS)
  })
})
