import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'

// A 4-page PDF whose pages are 600x800 at scale 1.
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
// page -> number of upcoming render() calls that should reject
const failNext = new Map<number, number>()
// page -> a render() promise the test resolves/rejects by hand
const held = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()
const holdPages = new Set<number>()
const fakeDoc = {
  numPages: 4,
  getPage: async (n: number) => ({
    getViewport: ({ scale }: { scale: number }) => makeViewport(scale),
    render: () => {
      if (holdPages.has(n)) {
        return { promise: new Promise<void>((resolve, reject) => { held.set(n, { resolve, reject }) }) }
      }
      const fails = failNext.get(n) ?? 0
      if (fails > 0) {
        failNext.set(n, fails - 1)
        return { promise: Promise.reject(new Error(`render failed ${n}`)) }
      }
      return { promise: Promise.resolve() }
    },
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
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() } }))

class FakeIntersectionObserver {
  observe() {}
  disconnect() {}
}

import { PDFViewer } from '../pdf-viewer'

beforeEach(() => {
  failNext.clear()
  held.clear()
  holdPages.clear()
  toastError.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => PAGE_W })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => PAGE_H })
  ;(HTMLElement.prototype as any).scrollTo = vi.fn()
  ;(HTMLCanvasElement.prototype as any).getContext = () => ({})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as any).clientWidth
  delete (HTMLElement.prototype as any).clientHeight
  delete (HTMLElement.prototype as any).scrollTo
})

const blob = new Blob(['%PDF'])

function wrapper(container: HTMLElement, page: number) {
  return container.querySelector<HTMLElement>(`[data-page-num="${page}"]`)!
}

describe('PDFViewer scroll mode: a page that fails to render (KAN-395)', () => {
  it('shows a failed state with Retry in the placeholder, and Retry draws the page', async () => {
    failNext.set(2, 1)
    const { container } = render(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={4} readingMode="scroll" />,
    )

    await waitFor(() => expect(wrapper(container, 2).querySelector('[data-page-failed]')).not.toBeNull())
    const page2 = wrapper(container, 2)
    expect(page2.textContent).toContain("Couldn't render page 2")
    expect(page2.querySelector('canvas')).toBeNull()
    // The placeholder keeps its height so the scroll position doesn't jump.
    expect(page2.style.height).toBe(`${PAGE_H}px`)
    expect(toastError).toHaveBeenCalledWith('Failed to render page 2', expect.anything())
    // Neighbours are unaffected.
    await waitFor(() => expect(wrapper(container, 3).querySelector('canvas')).not.toBeNull())
    expect(wrapper(container, 1).querySelector('canvas')).not.toBeNull()

    await act(async () => {
      page2.querySelector<HTMLButtonElement>('button')!.click()
    })

    await waitFor(() => expect(page2.querySelector('canvas')).not.toBeNull())
    expect(page2.querySelector('[data-page-failed]')).toBeNull()
  })

  it('treats a null 2D context as a failure instead of crashing on it', async () => {
    let calls = 0
    ;(HTMLCanvasElement.prototype as any).getContext = () => (++calls === 1 ? null : {})
    const { container } = render(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={4} readingMode="scroll" />,
    )

    await waitFor(() => expect(wrapper(container, 1).querySelector('[data-page-failed]')).not.toBeNull())
    await act(async () => {
      wrapper(container, 1).querySelector<HTMLButtonElement>('button')!.click()
    })
    await waitFor(() => expect(wrapper(container, 1).querySelector('canvas')).not.toBeNull())
  })

  it('shows only one failed state when Retry fails again', async () => {
    failNext.set(2, 2)
    const { container } = render(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={4} readingMode="scroll" />,
    )
    await waitFor(() => expect(wrapper(container, 2).querySelector('[data-page-failed]')).not.toBeNull())

    await act(async () => {
      wrapper(container, 2).querySelector<HTMLButtonElement>('button')!.click()
    })

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2))
    expect(wrapper(container, 2).querySelectorAll('[data-page-failed]')).toHaveLength(1)
  })

  it('stays silent when the render rejects after the viewer was torn down', async () => {
    holdPages.add(1)
    const view = render(
      <PDFViewer pdfBlob={blob} startPage={1} endPage={4} readingMode="scroll" />,
    )
    await waitFor(() => expect(held.has(1)).toBe(true))

    view.unmount()
    await act(async () => {
      held.get(1)!.reject(new Error('Worker was destroyed'))
    })

    expect(toastError).not.toHaveBeenCalled()
  })
})
