import { describe, it, expect } from 'vitest'
import { NibMarkdownParser } from '../markdown-parser'

describe('NibMarkdownParser', () => {
  const parser = new NibMarkdownParser()

  it('parses plain text into paragraphs and sentences with words', () => {
    const doc = parser.parse('Hello world. This is a test.', 'Title', 'Author')

    expect(doc.version).toBe(1)
    expect(doc.sourceTitle).toBe('Title')
    expect(doc.sourceAuthor).toBe('Author')
    expect(doc.pages).toHaveLength(1)

    const page = doc.pages[0]
    expect(page.pageNumber).toBe(1)
    expect(page.header).toBeNull()
    expect(page.footer).toBeNull()
    expect(page.footnotes).toEqual([])
    expect(page.figures).toEqual([])
    expect(page.listItems).toEqual([])

    const para = page.paragraphs[0]
    expect(para.blockType).toBe('body')
    expect(para.sentences).toHaveLength(2)

    expect(para.sentences[0].words.map(w => w.text)).toEqual(['Hello', 'world.'])
    expect(para.sentences[1].words.map(w => w.text)).toEqual(['This', 'is', 'a', 'test.'])
  })

  it('parses inline LaTeX into latex words within the same sentence', () => {
    const doc = parser.parse('The complexity is $O(mn)$ for this algorithm.', 'Title', 'Author')
    const sentence = doc.pages[0].paragraphs[0].sentences[0]

    expect(sentence.hasLatex).toBe(true)

    // "The complexity is" → 3 plain words
    const plainWords = sentence.words.filter(w => !w.isLatex)
    expect(plainWords.length).toBeGreaterThan(0)

    // LaTeX tokens from O(mn)
    const latexWords = sentence.words.filter(w => w.isLatex)
    expect(latexWords.length).toBeGreaterThan(0)
    expect(latexWords[0].latexSource).toBe('O(mn)')

    // All in one sentence
    expect(doc.pages[0].paragraphs[0].sentences).toHaveLength(1)
  })

  it('parses display math ($$...$$) as latex-display paragraph', () => {
    const doc = parser.parse('$$\\sum_{i=1}^{n} x_i$$', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.blockType).toBe('latex-display')
    expect(para.sentences).toHaveLength(1)

    const sentence = para.sentences[0]
    expect(sentence.hasLatex).toBe(true)
    expect(sentence.words.every(w => w.isLatex)).toBe(true)
    expect(sentence.words[0].latexSource).toBe('\\sum_{i=1}^{n} x_i')
  })

  it('parses blockquote (> text) as blockquote block type', () => {
    const doc = parser.parse('> This is a quote.', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.blockType).toBe('blockquote')
    expect(para.sentences[0].words.map(w => w.text)).toEqual(['This', 'is', 'a', 'quote.'])
  })

  it('parses list items (- item) as list-item block type', () => {
    const doc = parser.parse('- First item', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.blockType).toBe('list-item')
    expect(para.sentences[0].words.map(w => w.text)).toEqual(['First', 'item'])
  })

  it('parses list items with * marker', () => {
    const doc = parser.parse('* Star item', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.blockType).toBe('list-item')
    expect(para.sentences[0].words.map(w => w.text)).toEqual(['Star', 'item'])
  })

  it('does not split sentences on abbreviations', () => {
    const doc = parser.parse('This is e.g. an example.', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    // Should be one sentence, not split at "e.g."
    expect(para.sentences).toHaveLength(1)
    expect(para.sentences[0].words.map(w => w.text)).toEqual([
      'This', 'is', 'e.g.', 'an', 'example.',
    ])
  })

  it('does not split on single uppercase letter abbreviation (e.g. "A.")', () => {
    const doc = parser.parse('Section A. is important.', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    // "A." should not trigger a split
    expect(para.sentences).toHaveLength(1)
  })

  it('does not split on i.e.', () => {
    const doc = parser.parse('We use i.e. this one.', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.sentences).toHaveLength(1)
  })

  it('handles multiple inline formulas in one sentence', () => {
    const doc = parser.parse('Given $x$ and $y$ we compute.', 'Title', 'Author')

    const para = doc.pages[0].paragraphs[0]
    expect(para.sentences).toHaveLength(1)

    const sentence = para.sentences[0]
    expect(sentence.hasLatex).toBe(true)

    const latexWords = sentence.words.filter(w => w.isLatex)
    // Should have tokens from both $x$ and $y$
    const sources = new Set(latexWords.map(w => w.latexSource))
    expect(sources.has('x')).toBe(true)
    expect(sources.has('y')).toBe(true)
  })

  it('handles mixed paragraphs with text and formulas', () => {
    const markdown = `This is plain text. It has two sentences.

$$\\alpha + \\beta$$

The result uses $\\gamma$ in context.`

    const doc = parser.parse(markdown, 'Mixed', 'Author')
    const paras = doc.pages[0].paragraphs

    expect(paras).toHaveLength(3)

    // First paragraph: plain body text
    expect(paras[0].blockType).toBe('body')
    expect(paras[0].sentences).toHaveLength(2)
    expect(paras[0].sentences[0].hasLatex).toBeFalsy()

    // Second paragraph: display math
    expect(paras[1].blockType).toBe('latex-display')
    expect(paras[1].sentences[0].hasLatex).toBe(true)

    // Third paragraph: body with inline latex
    expect(paras[2].blockType).toBe('body')
    expect(paras[2].sentences[0].hasLatex).toBe(true)
    const latexWords = paras[2].sentences[0].words.filter(w => w.isLatex)
    expect(latexWords[0].latexSource).toBe('\\gamma')
  })

  it('sets correct word indices within each sentence', () => {
    const doc = parser.parse('One two three.', 'Title', 'Author')
    const words = doc.pages[0].paragraphs[0].sentences[0].words

    expect(words[0].index).toBe(0)
    expect(words[1].index).toBe(1)
    expect(words[2].index).toBe(2)
  })

  it('sets correct paragraph indices', () => {
    const doc = parser.parse('First.\n\nSecond.\n\nThird.', 'Title', 'Author')
    const paras = doc.pages[0].paragraphs

    expect(paras[0].index).toBe(0)
    expect(paras[1].index).toBe(1)
    expect(paras[2].index).toBe(2)
  })

  it('sets correct sentence indices within a paragraph', () => {
    const doc = parser.parse('First sentence. Second sentence. Third sentence.', 'Title', 'Author')
    const sentences = doc.pages[0].paragraphs[0].sentences

    expect(sentences[0].index).toBe(0)
    expect(sentences[1].index).toBe(1)
    expect(sentences[2].index).toBe(2)
  })

  it('marks decorative tokens from inline LaTeX', () => {
    const doc = parser.parse('Formula $a+b$ here.', 'Title', 'Author')
    const words = doc.pages[0].paragraphs[0].sentences[0].words
    const latexWords = words.filter(w => w.isLatex)

    // '+' should be decorative, 'a' and 'b' should not
    const plus = latexWords.find(w => w.text === '+')
    expect(plus?.isDecorative).toBe(true)

    const a = latexWords.find(w => w.text === 'a')
    expect(a?.isDecorative).toBe(false)
  })

  it('handles sentences ending with ? and !', () => {
    const doc = parser.parse('Is this right? Yes! Okay.', 'Title', 'Author')
    const sentences = doc.pages[0].paragraphs[0].sentences

    expect(sentences).toHaveLength(3)
    expect(sentences[0].words.map(w => w.text)).toEqual(['Is', 'this', 'right?'])
    expect(sentences[1].words.map(w => w.text)).toEqual(['Yes!'])
    expect(sentences[2].words.map(w => w.text)).toEqual(['Okay.'])
  })

  it('hasLatex is undefined (falsy) for plain text sentences', () => {
    const doc = parser.parse('No math here.', 'Title', 'Author')
    const sentence = doc.pages[0].paragraphs[0].sentences[0]
    expect(sentence.hasLatex).toBeUndefined()
  })
})
