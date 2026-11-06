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

import { PageStripEditor, dividersFromTocSuggestion } from '../page-strip-editor'

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
})
