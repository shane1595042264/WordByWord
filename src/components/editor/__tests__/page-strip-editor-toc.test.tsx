import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Same pdf.js stubs as page-strip-editor-a11y.test.tsx: thumbnails stay on their
// placeholder branch and nothing touches DOMMatrix.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}))
vi.mock('@/lib/services/pdf-service', () => ({
  PdfPageRenderer: class {
    renderPage() { return new Promise<string>(() => {}) }
    destroy() {}
  },
}))

const suggestFromTOC = vi.fn()
vi.mock('@/lib/services/structure-service', () => ({
  StructureService: class {
    suggestFromTOC(...args: unknown[]) { return suggestFromTOC(...args) }
  },
}))

import { PageStripEditor, dividersFromTocSuggestion, tocPageOffset } from '../page-strip-editor'

describe('dividersFromTocSuggestion (KAN-388)', () => {
  it('keeps only in-range, deduped section starts when dividing a chapter', () => {
    // Book-level suggestion for a chapter spanning 50-60: the chapter itself,
    // its nested sections (one repeated page, one at the chapter start), and two
    // later chapters that lie entirely past the range.
    const data = {
      suggestions: {
        chapters: [
          {
            title: 'Ch 3',
            startPage: 50,
            sections: [
              { title: '3.1 Intro', startPage: 50 },
              { title: '3.2 Body', startPage: 55 },
              { title: '3.2 Body (dup)', startPage: 55 },
              { title: '3.3 End', startPage: 58 },
            ],
          },
          { title: 'Ch 4', startPage: 75 },
          { title: 'Ch 5', startPage: 100 },
        ],
      },
    }

    expect(dividersFromTocSuggestion(data, 50, 60, 'section')).toEqual([
      { page: 55, title: '3.2 Body' },
      { page: 58, title: '3.3 End' },
    ])
  })

  it('ignores nested sections and out-of-book pages when reorganizing chapters', () => {
    const data = {
      suggestions: {
        chapters: [
          { title: 'Front', startPage: 1, sections: [{ title: '1.1', startPage: 3 }] },
          { title: 'Two', startPage: 12 },
          { title: 'Two again', startPage: 12 },
          { title: '', startPage: 20 },
          { title: 'Past the end', startPage: 31 },
          { title: 'Bad page', startPage: 7.5 },
        ],
      },
    }

    expect(dividersFromTocSuggestion(data, 1, 30, 'chapter')).toEqual([
      { page: 12, title: 'Two' },
      { page: 20, title: 'Chapter 3' },
    ])
  })

  it('returns nothing for an empty or missing response', () => {
    expect(dividersFromTocSuggestion(null, 1, 10, 'chapter')).toEqual([])
    expect(dividersFromTocSuggestion({ chapters: [{ title: 'x', startPage: 40 }] }, 1, 10, 'chapter')).toEqual([])
  })
})

describe('PageStripEditor Process TOC (KAN-388)', () => {
  beforeEach(() => {
    suggestFromTOC.mockReset()
  })

  async function renderSectionStrip() {
    const onSave = vi.fn().mockResolvedValue(undefined)
    await act(async () => {
      render(
        <PageStripEditor
          pdfBlob={new Blob(['%PDF-1.4'], { type: 'application/pdf' })}
          startPage={50}
          endPage={60}
          totalBookPages={200}
          bookRemoteId="book-1"
          existingDividers={[]}
          level="section"
          onSave={onSave}
          onClose={vi.fn()}
        />,
      )
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    return { onSave }
  }

  async function processToc() {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Select TOC Pages/ })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Page 50' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Process TOC/ })) })
    // The structure service is a dynamic import, so the request lands a few ticks later.
    await waitFor(() => expect(screen.queryByText('Processing...')).toBeNull())
    expect(suggestFromTOC).toHaveBeenCalledWith('book-1', [50])
  }

  it('only places dividers the strip can draw, and saves exactly those', async () => {
    suggestFromTOC.mockResolvedValue({
      suggestions: {
        chapters: [
          { title: 'Ch 3', startPage: 50, sections: [{ title: '3.2', startPage: 55 }] },
          { title: 'Ch 3 dup', startPage: 55 },
          { title: 'Ch 4', startPage: 75 },
          { title: 'Ch 5', startPage: 100 },
        ],
      },
    })
    const { onSave } = await renderSectionStrip()
    await processToc()

    // One bar drawn, and the info bar counts the same one divider.
    expect(screen.getAllByRole('button', { name: /^Remove section divider/ })).toHaveLength(1)
    expect(screen.getByText(/1 divider/)).toBeTruthy()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept' })) })
    expect(onSave).toHaveBeenCalledWith([{ page: 55, title: '3.2' }])
  })

  it('shows the no-results error when every start is outside the chapter', async () => {
    suggestFromTOC.mockResolvedValue({
      suggestions: { chapters: [{ title: 'Ch 4', startPage: 75 }, { title: 'Ch 5', startPage: 100 }] },
    })
    await renderSectionStrip()
    await processToc()

    expect(screen.getByText(/No sections detected/)).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /^Remove section divider/ })).toHaveLength(0)
  })
  it('shifts printed pages by the server pageOffset, and the page-1 field re-places them (KAN-410)', async () => {
    // Printed pages 1-11 of a chapter that sits at PDF pages 50-60: offset 49.
    suggestFromTOC.mockResolvedValue({
      suggestions: { chapters: [{ title: 'Ch 3', startPage: 1, sections: [{ title: '3.1', startPage: 1 }, { title: '3.2', startPage: 6 }] }] },
      pageOffset: 49,
      pageOffsetSource: 'titles',
    })
    const { onSave } = await renderSectionStrip()
    await processToc()

    const pageOne = screen.getByLabelText('Printed page 1 = PDF page') as HTMLInputElement
    expect(pageOne.value).toBe('50')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept' })) })
    expect(onSave).toHaveBeenLastCalledWith([{ page: 55, title: '3.2' }])

    // The guess was one page off: correcting it moves the divider without a new AI call.
    await act(async () => { fireEvent.change(pageOne, { target: { value: '51' } }) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Accept' })) })
    expect(onSave).toHaveBeenLastCalledWith([{ page: 51, title: 'Ch 3' }, { page: 56, title: '3.2' }])
    expect(suggestFromTOC).toHaveBeenCalledTimes(1)
  })
})

// The TOC lists printed page numbers; with 14 front-matter pages, printed page 1 is
// PDF page 15 and every divider used to land 14 pages early. KAN-410.
describe('dividersFromTocSuggestion page offset (KAN-410)', () => {
  const data = {
    suggestions: {
      chapters: [
        { title: 'Chapter 1', startPage: 1 },
        { title: 'Chapter 2', startPage: 20 },
        { title: 'Chapter 3', startPage: 41 },
      ],
    },
  }

  it('maps printed pages 1/20/41 to PDF pages 15/34/55 with a 14-page offset', () => {
    // Chapter 1 now starts at the strip's first page, so it is the implicit first segment.
    expect(dividersFromTocSuggestion(data, 15, 80, 'chapter', 14)).toEqual([
      { page: 34, title: 'Chapter 2' },
      { page: 55, title: 'Chapter 3' },
    ])
    // Whole-book strip (front matter included): Chapter 1 gets its own divider too.
    expect(dividersFromTocSuggestion(data, 1, 80, 'chapter', 14)).toEqual([
      { page: 15, title: 'Chapter 1' },
      { page: 34, title: 'Chapter 2' },
      { page: 55, title: 'Chapter 3' },
    ])
  })

  it('offset 0 (and no offset) gives the old output unchanged', () => {
    const before = [{ page: 20, title: 'Chapter 2' }, { page: 41, title: 'Chapter 3' }]
    expect(dividersFromTocSuggestion(data, 1, 80, 'chapter', 0)).toEqual(before)
    expect(dividersFromTocSuggestion(data, 1, 80, 'chapter')).toEqual(before)
  })

  it('applies the offset before the range filter, not after', () => {
    // Divide Sections for a chapter at PDF 15-34: printed section starts 1-20.
    const sections = { chapters: [{ title: 'Ch 1', startPage: 1, sections: [{ title: '1.1', startPage: 1 }, { title: '1.2', startPage: 8 }, { title: '1.3', startPage: 16 }] }] }
    expect(dividersFromTocSuggestion(sections, 15, 34, 'section')).toEqual([{ page: 16, title: '1.3' }])
    expect(dividersFromTocSuggestion(sections, 15, 34, 'section', 14)).toEqual([
      { page: 22, title: '1.2' },
      { page: 30, title: '1.3' },
    ])
  })

  it('reads only an integer pageOffset off the response', () => {
    expect(tocPageOffset({ pageOffset: 14 })).toBe(14)
    expect(tocPageOffset({})).toBe(0)
    expect(tocPageOffset({ pageOffset: 1.5 })).toBe(0)
    expect(tocPageOffset(null)).toBe(0)
  })
})
