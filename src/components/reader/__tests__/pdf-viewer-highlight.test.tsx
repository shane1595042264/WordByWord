import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

// A 6-page PDF whose pages are 600x800 at scale 1. Each page has one text run.
const PAGE_W = 600
const PAGE_H = 800
function makeViewport(scale: number) {
  return {
    width: PAGE_W * scale,
    height: PAGE_H * scale,
    scale,
    convertToViewportPoint: (x: number, y: number) => [x * scale, (PAGE_H - y) * scale],
  }
}
const renderedPages: number[] = []
const fakeDoc = {
  numPages: 6,
  getPage: async (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => makeViewport(scale),
    render: () => ({ promise: Promise.resolve().then(() => { renderedPages.push(n) }) }),
    getTextContent: async () => ({
      items: [{ str: `word${n}`, transform: [12, 0, 0, 12, 100, 700], width: 40, height: 12 }],
    }),
  }),
  destroy: () => {},
}

vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({ promise: Promise.resolve(fakeDoc) }),
  GlobalWorkerOptions: { workerSrc: '' },
}))
vi.mock('@/lib/pdf-text/text-layer', () => ({
  renderPdfTextLayer: async () => {},
  applyPdfTextLayerScale: () => {},
}))
vi.mock('@/components/reader/word-info-panel', () => ({ WordInfoPanel: () => null }))

// Lazy rendering is driven by the IntersectionObserver; the test decides which
// pages "approach the viewport".
let observerCallback: ((entries: { isIntersecting: boolean; target: Element }[]) => void) | null = null
class FakeIntersectionObserver {
  constructor(cb: typeof observerCallback) { observerCallback = cb }
  observe() {}
  disconnect() {}
}

import { PDFViewer, type HighlightWordInfo } from '../pdf-viewer'

const scrollTo = vi.fn()

beforeEach(() => {
  renderedPages.length = 0
  observerCallback = null
  scrollTo.mockClear()
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => PAGE_W })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PAGE_H })
  ;(HTMLElement.prototype as any).scrollTo = scrollTo
  ;(HTMLCanvasElement.prototype as any).getContext = () => ({})
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as any).clientWidth
  delete (HTMLElement.prototype as any).clientHeight
  delete (HTMLElement.prototype as any).scrollTo
})

const blob = new Blob(['%PDF'])

function wrapper(container: HTMLElement, page: number) {
  return container.querySelector<HTMLElement>(`[data-page-num="${page}"]`)!
}

async function drawPage(container: HTMLElement, page: number) {
  await act(async () => {
    observerCallback!([{ isIntersecting: true, target: wrapper(container, page) }])
  })
  await waitFor(() => expect(wrapper(container, page).querySelector('canvas')).not.toBeNull())
}

describe('PDFViewer highlight on a page that is not drawn yet (KAN-392)', () => {
  const word: HighlightWordInfo = {
    text: 'word5',
    pageNumber: 5,
    sentenceText: 'word5',
    wordIndex: 0,
    pdfRect: { pageNumber: 5, x: 100, y: 700, width: 40, height: 12 },
  }

  async function mountWithHighlight() {
    const view = render(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={6} readingMode="scroll" highlightWord={null} />,
    )
    // Phase 3 eagerly draws pages 1-3; page 5 stays a placeholder.
    await waitFor(() => expect(renderedPages).toEqual([1, 2, 3]))
    view.rerender(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={6} readingMode="scroll" highlightWord={word} />,
    )
    expect(view.container.querySelector('.pdf-word-highlight')).toBeNull()
    return view
  }

  it('shows the highlight once the target page finishes drawing', async () => {
    const { container } = await mountWithHighlight()

    await drawPage(container, 5)

    await waitFor(() => expect(wrapper(container, 5).querySelector('.pdf-word-highlight')).not.toBeNull())
    const overlay = wrapper(container, 5).querySelector<HTMLElement>('.pdf-word-highlight')!
    // pdfRect (100, 700) at scale 1 → top = (800 - 700) - 12 * 0.85
    expect(overlay.style.left).toBe('100px')
    expect(parseFloat(overlay.style.top)).toBeCloseTo(100 - 12 * 0.85)
  })

  it('does not re-place or re-scroll the highlight when an unrelated page draws later', async () => {
    const { container } = await mountWithHighlight()
    await drawPage(container, 5)
    await waitFor(() => expect(wrapper(container, 5).querySelector('.pdf-word-highlight')).not.toBeNull())
    const overlay = wrapper(container, 5).querySelector('.pdf-word-highlight')
    const scrollsBefore = scrollTo.mock.calls.length

    await drawPage(container, 6)

    expect(wrapper(container, 5).querySelector('.pdf-word-highlight')).toBe(overlay)
    expect(scrollTo.mock.calls.length).toBe(scrollsBefore)
  })

  it('still re-places the highlight when the same word is picked again', async () => {
    const view = await mountWithHighlight()
    await drawPage(view.container, 5)
    await waitFor(() => expect(wrapper(view.container, 5).querySelector('.pdf-word-highlight')).not.toBeNull())
    const overlay = wrapper(view.container, 5).querySelector('.pdf-word-highlight')

    view.rerender(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={6} readingMode="scroll" highlightWord={{ ...word }} />,
    )

    const again = wrapper(view.container, 5).querySelector('.pdf-word-highlight')
    expect(again).not.toBeNull()
    expect(again).not.toBe(overlay)
  })
})
