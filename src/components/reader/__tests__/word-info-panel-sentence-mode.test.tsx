import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NibPage, type NibWord, type NibWordData } from '@/lib/nib'

/**
 * KAN-399: the word/block auto-translate effect had no panelMode check, so a
 * sentence-mode panel also paid for a translateWord (or explainContent) call
 * whose result the sentence branch never renders.
 */

const translateWord = vi.fn(async (word: string) => ({
  word, pronunciation: '/test/', translation: 'prueba', partOfSpeech: 'noun',
}))
const translateSentence = vi.fn(async () => ({ translation: 'Esto es una prueba.' }))
const explainContent = vi.fn(async () => 'A table.')
vi.mock('@/lib/services/translation-service', () => ({
  TranslationService: class {
    translateWord = translateWord
    translateSentence = translateSentence
    explainContent = explainContent
  },
}))

vi.mock('@/lib/services/vocab-service', () => ({
  VocabService: class {
    findByWordAndContext = vi.fn(async () => [])
  },
}))

import { WordInfoPanel } from '../word-info-panel'
import { ShortcutProvider } from '@/hooks/use-shortcuts'
import { TooltipProvider } from '@/components/ui/tooltip'

function makeWords(words: NibWordData[]): NibWord[] {
  return new NibPage({
    pageNumber: 1,
    header: null,
    footer: null,
    footnotes: [],
    paragraphs: [{ index: 0, sentences: [{ index: 0, words }] }],
    figures: [],
    listItems: [],
  }).paragraphs[0].sentences[0].words
}

const word = makeWords(['This', 'is', 'a', 'test', '.'].map((text, index) => ({ text, index })))[3]
const blockWord = makeWords([{ text: '[Table]', index: 0, latexSource: '\\begin{tabular}{c}x\\end{tabular}' }])[0]

// The word effect reaches translateWord behind two dynamic imports, so a
// negative assertion has to let those settle first or it passes vacuously.
const settle = () => new Promise(r => setTimeout(r, 100))

function panel(w: NibWord, panelMode: 'word' | 'sentence') {
  return (
    <ShortcutProvider>
      <TooltipProvider>
        <WordInfoPanel word={w} anchorEl={null} onClose={() => {}} panelMode={panelMode} />
      </TooltipProvider>
    </ShortcutProvider>
  )
}

describe('WordInfoPanel sentence mode AI calls (KAN-399)', () => {
  beforeEach(() => {
    translateWord.mockClear()
    translateSentence.mockClear()
    explainContent.mockClear()
  })

  it('sentence mode translates the sentence only', async () => {
    render(panel(word, 'sentence'))
    await screen.findByText('Esto es una prueba.')
    await settle()
    expect(translateSentence).toHaveBeenCalledTimes(1)
    expect(translateWord).not.toHaveBeenCalled()
    expect(explainContent).not.toHaveBeenCalled()
  })

  it('sentence mode on block content does not auto-explain it', async () => {
    render(panel(blockWord, 'sentence'))
    await settle()
    expect(explainContent).not.toHaveBeenCalled()
    expect(translateWord).not.toHaveBeenCalled()
    expect(translateSentence).toHaveBeenCalledTimes(1)
  })

  it('word mode still translates the word (control)', async () => {
    render(panel(word, 'word'))
    await screen.findByText('prueba')
    expect(translateWord).toHaveBeenCalledTimes(1)
    expect(translateSentence).not.toHaveBeenCalled()
  })

  it('switching back to word mode on the same word loads its translation', async () => {
    const { rerender } = render(panel(word, 'sentence'))
    await screen.findByText('Esto es una prueba.')
    await settle()
    expect(translateWord).not.toHaveBeenCalled()
    rerender(panel(word, 'word'))
    await screen.findByText('prueba')
    expect(translateWord).toHaveBeenCalledTimes(1)
  })
})
