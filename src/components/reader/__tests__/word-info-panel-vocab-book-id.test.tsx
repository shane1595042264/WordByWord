import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NibPage, type NibWord } from '@/lib/nib'

/**
 * KAN-354: handleAddVocab never passed a bookId to svc.add(), so every word saved
 * from the reader was bookless and the book-delete vocab cascades (local
 * where('bookId'), backend softDeleteByBookId) matched nothing.
 */

const add = vi.fn(async (..._args: unknown[]) => 'vocab-1')
vi.mock('@/lib/services/vocab-service', () => ({
  VocabService: class {
    findByWordAndContext = vi.fn(async () => [])
    add = add
  },
}))

vi.mock('@/lib/services/translation-service', () => ({
  TranslationService: class {
    translateWord = vi.fn(async (word: string) => ({
      word, pronunciation: '/test/', translation: 'prueba', partOfSpeech: 'noun',
    }))
  },
}))

import { WordInfoPanel } from '../word-info-panel'
import { ShortcutProvider } from '@/hooks/use-shortcuts'
import { TooltipProvider } from '@/components/ui/tooltip'

const word: NibWord = new NibPage({
  pageNumber: 3,
  header: null,
  footer: null,
  footnotes: [],
  paragraphs: [{ index: 0, sentences: [{ index: 0, words: ['This', 'is', 'a', 'test', '.'].map((text, index) => ({ text, index })) }] }],
  figures: [],
  listItems: [],
}).paragraphs[0].sentences[0].words[3]

function renderPanel(bookId?: string) {
  return render(
    <ShortcutProvider>
      <TooltipProvider>
        <WordInfoPanel
          word={word}
          anchorEl={null}
          onClose={() => {}}
          bookId={bookId}
          bookTitle="Book"
          sectionTitle="Ch 1"
        />
      </TooltipProvider>
    </ShortcutProvider>,
  )
}

async function clickAdd() {
  const btn = await screen.findByText('Add to vocab')
  const button = btn.closest('button')!
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
  await waitFor(() => expect(add).toHaveBeenCalledTimes(1))
}

describe('WordInfoPanel add-to-vocab bookId (KAN-354)', () => {
  beforeEach(() => add.mockClear())

  it('records the book id on the saved vocab entry', async () => {
    renderPanel('local-book-1')
    await clickAdd()
    expect(add.mock.calls[0][0]).toMatchObject({
      word: 'test',
      bookId: 'local-book-1',
      bookTitle: 'Book',
      sectionTitle: 'Ch 1',
      pageNumber: 3,
    })
  })

  it('leaves bookId undefined when the panel has no book', async () => {
    renderPanel(undefined)
    await clickAdd()
    expect((add.mock.calls[0][0] as { bookId?: string }).bookId).toBeUndefined()
  })
})
