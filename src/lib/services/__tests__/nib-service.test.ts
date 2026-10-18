import { describe, it, expect } from 'vitest'
import { NibService } from '../nib-service'

// Opening paragraphs, then an all-caps line the text parser treats as a header.
const CHAPTER = [
  'Risotto is part of the triumvirate of soul-satisfying Italian starches.',
  '',
  'Arborio rice gives the dish its creamy texture when stirred slowly.',
  '',
  'THE BASIC TECHNIQUE',
  '',
  'Heat the broth and keep it at a gentle simmer on the back burner.',
].join('\n')

describe('NibService.parseExtractedTextWholeChapter', () => {
  const service = new NibService()

  it('keeps the paragraphs before the first header-like line', () => {
    const text = service.parseExtractedTextWholeChapter(CHAPTER, 'Book', 'Author').fullText
    expect(text).toContain('triumvirate')
    expect(text).toContain('Arborio rice')
    expect(text).toContain('gentle simmer')
  })

  it('matches parseExtractedText word for word and clears the introduction tag', () => {
    const whole = service.parseExtractedTextWholeChapter(CHAPTER, 'Book', 'Author')
    const plain = service.parseExtractedText(CHAPTER, 'Book', 'Author')
    expect(whole.wordCount).toBe(plain.wordCount)
    const blockTypes = whole.pages.flatMap(p => p.paragraphs.map(para => para.blockType))
    expect(blockTypes).not.toContain('introduction')
  })

  it('body-only parsing still strips the text before the header (PDF intro overflow)', () => {
    const text = service.parseExtractedTextBodyOnly(CHAPTER, 'Book', 'Author').fullText
    expect(text).not.toContain('triumvirate')
    expect(text).toContain('gentle simmer')
  })
})
