import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

// pdfjs-dist reaches for browser globals (DOMMatrix) at module scope, so it is
// stubbed the same way src/lib/services/__tests__/pdf-page-renderer.test.ts does.
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}))

// The strip dynamically imports pdf.js so it never loads during SSR. Nothing here
// depends on a real page decode, so renderPage returns a promise that never
// settles — that keeps the thumbnails on their placeholder branch without
// scheduling a state update outside act().
const destroy = vi.fn()
vi.mock('@/lib/services/pdf-service', () => ({
  PdfPageRenderer: class {
    renderPage() { return new Promise<string>(() => {}) }
    destroy() { destroy() }
  },
}))

import { PageStripEditor } from '../page-strip-editor'

/** Render the strip and let the dynamic pdf-service import settle. */
async function renderStrip() {
  const onSave = vi.fn().mockResolvedValue(undefined)
  await act(async () => {
    render(
      <PageStripEditor
        pdfBlob={new Blob(['%PDF-1.4'], { type: 'application/pdf' })}
        startPage={1}
        endPage={5}
        totalBookPages={5}
        bookRemoteId="book-1"
        existingDividers={[]}
        level="chapter"
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )
    // Let the dynamic pdf-service import and the setRenderer it triggers land.
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return { onSave }
}

const gap = (page: number) =>
  screen.getByRole('button', { name: `Add chapter divider before page ${page}` })

describe('PageStripEditor keyboard + screen-reader access (KAN-294)', () => {
  beforeEach(() => {
    destroy.mockClear()
  })

  it('exposes every inter-page gap as a focusable named control', async () => {
    await renderStrip()

    // One gap before each page except the first.
    const gaps = screen.getAllByRole('button', { name: /^Add chapter divider before page \d+$/ })
    expect(gaps.map(g => g.getAttribute('aria-label'))).toEqual([
      'Add chapter divider before page 2',
      'Add chapter divider before page 3',
      'Add chapter divider before page 4',
      'Add chapter divider before page 5',
    ])

    for (const g of gaps) {
      // Focusing a gap flips it to its "+" affordance, so it is a state update.
      await act(async () => { g.focus() })
      expect(document.activeElement).toBe(g)
    }
  })

  it('adds a divider at the focused page on keyboard activation and keeps focus in the strip', async () => {
    await renderStrip()

    const target = gap(3)
    await act(async () => { target.focus() })
    // detail === 0 is what the browser reports for Enter/Space on a button.
    await act(async () => { fireEvent.click(target, { detail: 0 }) })

    const title = screen.getByRole('textbox', {
      name: 'Chapter title for the chapter starting at page 3',
    })
    expect(title).toBeDefined()
    // The activated gap unmounts; without the hand-off focus would fall to <body>
    // and a second divider would cost a full re-Tab through the strip.
    expect(document.activeElement).toBe(title)

    // The gap it replaced is gone, its neighbours remain.
    expect(screen.queryByRole('button', { name: 'Add chapter divider before page 3' })).toBeNull()
    expect(gap(4)).toBeDefined()
  })

  it('leaves mouse behaviour unchanged — a pointer click adds the divider without stealing focus', async () => {
    await renderStrip()

    const target = gap(2)
    // detail >= 1 is a real pointer click.
    await act(async () => { fireEvent.click(target, { detail: 1 }) })

    expect(
      screen.getByRole('textbox', { name: 'Chapter title for the chapter starting at page 2' }),
    ).toBeDefined()
    expect(document.activeElement).toBe(document.body)
  })

  it('names each divider control per page so they are distinguishable', async () => {
    await renderStrip()

    await act(async () => { fireEvent.click(gap(2), { detail: 1 }) })
    await act(async () => { fireEvent.click(gap(4), { detail: 1 }) })

    const removes = screen
      .getAllByRole('button', { name: /^Remove chapter divider before page \d+$/ })
      .map(b => b.getAttribute('aria-label'))
    expect(removes).toEqual([
      'Remove chapter divider before page 2',
      'Remove chapter divider before page 4',
    ])

    // Activating a remove button drops only that divider.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove chapter divider before page 2' }))
    })
    expect(
      screen.queryByRole('textbox', { name: 'Chapter title for the chapter starting at page 2' }),
    ).toBeNull()
    expect(
      screen.getByRole('textbox', { name: 'Chapter title for the chapter starting at page 4' }),
    ).toBeDefined()
  })

  it('does not leave a stuck "+" on a gap that reappears after its divider is removed', async () => {
    await renderStrip()

    const target = gap(3)
    await act(async () => { target.focus() })
    await act(async () => { fireEvent.click(target, { detail: 0 }) })
    // React fires no blur when the activated gap unmounts, so the focus flag
    // would otherwise stay pointing at page 3.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove chapter divider before page 3' }))
    })

    const reappeared = gap(3)
    expect(document.activeElement).not.toBe(reappeared)
    expect(reappeared.textContent).toBe('')
  })

  it('pairs the Expected count label with its input', async () => {
    await renderStrip()
    expect(screen.getByLabelText('Expected count:')).toBeDefined()
  })

  it('reports thumbnail selection state only while TOC-select mode is on', async () => {
    await renderStrip()

    const tile = () => screen.getByRole('button', { name: 'Page 2' })
    // Outside TOC-select mode the tile is not a toggle, so it must not claim to
    // be an unpressed one.
    expect(tile().hasAttribute('aria-pressed')).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Select TOC Pages' }))
    })
    expect(tile().getAttribute('aria-pressed')).toBe('false')

    await act(async () => { fireEvent.click(tile()) })
    expect(tile().getAttribute('aria-pressed')).toBe('true')

    await act(async () => { fireEvent.click(tile()) })
    expect(tile().getAttribute('aria-pressed')).toBe('false')
  })
})
