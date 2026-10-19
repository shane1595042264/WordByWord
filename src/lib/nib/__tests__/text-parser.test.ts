import { describe, it, expect } from 'vitest'
import { NibTextParser } from '../text-parser'
import { NibService } from '@/lib/services/nib-service'

const bodyWords = (page: { paragraphs: { sentences: { words: { text: string }[] }[] }[] }) =>
  page.paragraphs.flatMap(p => p.sentences.flatMap(s => s.words.map(w => w.text)))

describe('NibTextParser footnotes', () => {
  const parser = new NibTextParser()

  it('keeps the first character of the footnote text', () => {
    const page = parser.parseText(
      'Body text here.\n\n16 https://use-the-index-luke.com/sql/where-clause',
      'T', 'A',
    ).pages[0]

    expect(page.footnotes).toEqual([
      { marker: '16', text: 'https://use-the-index-luke.com/sql/where-clause' },
    ])
  })

  it('keeps the first character after a symbol marker', () => {
    const page = parser.parseText('Body.\n\n* The author disagrees.', 'T', 'A').pages[0]

    expect(page.footnotes).toEqual([{ marker: '*', text: 'The author disagrees.' }])
  })

  it('does not treat a line without a marker as a footnote', () => {
    const page = parser.parseText('Body.\n\n12345', 'T', 'A').pages[0]

    expect(page.footnotes).toEqual([])
  })
})

describe('NibService.parseExtractedTextWholeChapter (EPUB)', () => {
  it('keeps numbered ingredient lines in the body with every word', () => {
    const text = [
      'Rice Pilaf',
      '',
      '2 cups long-grain white rice',
      '',
      '1 teaspoon salt',
      '',
      '3 tablespoons unsalted butter',
      '',
      'Melt the butter and stir in the rice.',
    ].join('\n')

    const doc = new NibService().parseExtractedTextWholeChapter(text, 'T', 'A').toData()
    const page = doc.pages[0]

    expect(page.footnotes).toEqual([])
    const words = bodyWords(page)
    expect(words.join(' ')).toContain('2 cups long-grain white rice')
    expect(words.join(' ')).toContain('1 teaspoon salt')
    expect(words.join(' ')).toContain('3 tablespoons unsalted butter')
  })

  it('still detects footnotes on the PDF text path', () => {
    const doc = new NibService().parseExtractedText('Body.\n\n1 He just did.', 'T', 'A').toData()

    expect(doc.pages[0].footnotes).toEqual([{ marker: '1', text: 'He just did.' }])
  })
})
