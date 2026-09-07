import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PdfPageRenderer } from '../pdf-service'

// Mock pdfjs-dist since it needs browser APIs
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}))

/** jsdom has no real canvas — hand back a stub that satisfies renderPage. */
function stubCanvas() {
  const realCreateElement = document.createElement.bind(document)
  return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag !== 'canvas') return realCreateElement(tag)
    return {
      width: 0,
      height: 0,
      getContext: () => ({}),
      toDataURL: () => 'data:image/png;base64,thumb',
    } as unknown as HTMLCanvasElement
  })
}

/** A doc whose page renders block until the returned control is resolved. */
function makeMockDoc() {
  const pending: Array<() => void> = []
  const cleanup = vi.fn()
  const destroy = vi.fn()
  const getPage = vi.fn().mockImplementation(async () => ({
    getViewport: () => ({ width: 10, height: 14 }),
    render: () => ({ promise: new Promise<void>(resolve => pending.push(resolve)) }),
    cleanup,
  }))
  return { doc: { getPage, destroy }, pending, cleanup, destroy, getPage }
}

describe('PdfPageRenderer', () => {
  let createElementSpy: ReturnType<typeof stubCanvas>

  beforeEach(() => {
    createElementSpy = stubCanvas()
  })

  afterEach(() => {
    createElementSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('parses the PDF once no matter how many pages are rendered', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc, pending } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']), 100)
    const renders = [1, 2, 3, 4, 5].map(page => renderer.renderPage(page))

    // Let the blob read + getDocument + getPage microtasks settle.
    await vi.waitFor(() => expect(pending).toHaveLength(5))
    pending.forEach(resolve => resolve())
    const results = await Promise.all(renders)

    expect(results).toEqual(Array(5).fill('data:image/png;base64,thumb'))
    expect(vi.mocked(getDocument)).toHaveBeenCalledTimes(1)
  })

  it('never runs more than maxConcurrent renders at once', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc, pending } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']), 2)
    const renders = Array.from({ length: 6 }, (_, i) => renderer.renderPage(i + 1))

    // Drain one render at a time, recording how many were ever in flight at
    // once. Finishing one must admit exactly one more, never a flood.
    let peakInFlight = 0
    for (let i = 0; i < renders.length; i++) {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
      peakInFlight = Math.max(peakInFlight, pending.length)
      expect(pending.length).toBeLessThanOrEqual(2)
      pending.shift()!()
    }

    await Promise.all(renders)
    expect(peakInFlight).toBe(2)
    expect(vi.mocked(getDocument)).toHaveBeenCalledTimes(1)
  })

  it('cleans up each page after rendering it', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc, pending, cleanup } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']), 1)
    const render = renderer.renderPage(7)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0]()
    await render

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('destroys the shared document and rejects later renders', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc, pending, destroy } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']), 1)
    const first = renderer.renderPage(1)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending[0]()
    await first

    renderer.destroy()
    await vi.waitFor(() => expect(destroy).toHaveBeenCalledTimes(1))
    await expect(renderer.renderPage(2)).rejects.toThrow('destroyed')
  })

  it('releases queued renders when destroyed mid-flight', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc, pending } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']), 1)
    const first = renderer.renderPage(1)
    const queued = renderer.renderPage(2)
    const queuedResult = queued.catch((err: Error) => err.message)

    await vi.waitFor(() => expect(pending).toHaveLength(1))
    renderer.destroy()
    pending[0]()
    await first.catch(() => {})

    expect(await queuedResult).toContain('destroyed')
  })

  it('does not touch the PDF until a page is actually requested', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const { doc } = makeMockDoc()
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const renderer = new PdfPageRenderer(new Blob(['pdf']))
    await Promise.resolve()

    expect(vi.mocked(getDocument)).not.toHaveBeenCalled()
    renderer.destroy()
  })
})
