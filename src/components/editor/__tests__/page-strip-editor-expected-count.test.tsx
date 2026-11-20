import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

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

import { PageStripEditor, dividersForExpectedCount } from '../page-strip-editor'

describe('dividersForExpectedCount (KAN-412)', () => {
  it('gives exactly the requested number of near-equal parts for every range and count', () => {
    for (const startPage of [1, 37]) {
      for (let range = 1; range <= 60; range++) {
        const endPage = startPage + range - 1
        for (let count = 1; count <= range; count++) {
          const pages = dividersForExpectedCount(count, startPage, endPage, 'section').map(d => d.page)
          expect(pages).toHaveLength(count - 1)
          const bounds = [startPage, ...pages, endPage + 1]
          const sizes = bounds.slice(1).map((b, i) => b - bounds[i])
          // Ascending, distinct, inside (startPage, endPage].
          expect(sizes.every(s => s >= 1)).toBe(true)
          expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('splits 12 pages into 5 parts instead of 4', () => {
    expect(dividersForExpectedCount(5, 1, 12, 'chapter')).toEqual([
      { page: 3, title: 'Chapter 2' },
      { page: 6, title: 'Chapter 3' },
      { page: 8, title: 'Chapter 4' },
      { page: 11, title: 'Chapter 5' },
    ])
  })

  it('leaves an evenly divisible count where it was', () => {
    expect(dividersForExpectedCount(4, 1, 12, 'section').map(d => d.page)).toEqual([4, 7, 10])
  })

  it('caps a count above the page count at one part per page', () => {
    expect(dividersForExpectedCount(9, 10, 13, 'section').map(d => d.page)).toEqual([11, 12, 13])
  })
})

describe('PageStripEditor Expected count (KAN-412)', () => {
  function renderEditor() {
    render(
      <PageStripEditor
        pdfBlob={new Blob(['%PDF'], { type: 'application/pdf' })}
        startPage={20}
        endPage={31}
        totalBookPages={300}
        bookRemoteId="book-1"
        existingDividers={[]}
        level="section"
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    )
    return screen.getByLabelText('Expected count:') as HTMLInputElement
  }

  function dividerPages() {
    return [...document.querySelectorAll<HTMLInputElement>('[data-divider-title]')]
      .map(el => Number(el.dataset.dividerTitle))
  }

  it('places count - 1 dividers on Enter', () => {
    const input = renderEditor()
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(dividerPages()).toEqual([22, 25, 27, 30])
  })

  it('rewrites a count above the range size to the cap', () => {
    const input = renderEditor()
    expect(input.max).toBe('12')
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input.value).toBe('12')
    expect(dividerPages()).toHaveLength(11)
  })
})
