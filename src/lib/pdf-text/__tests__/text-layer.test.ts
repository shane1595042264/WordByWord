import { describe, it, expect, vi } from 'vitest'
import {
  renderPdfTextLayer,
  splitSpanIntoWords,
  applyPdfTextLayerScale,
  type PdfjsTextLayerModule,
} from '../text-layer'
import {
  PDF_LAYER_RAW_WIDTH_ATTR,
  PDF_TEXT_LAYER_CLASS,
  PDF_WORD_CLASS,
  PDF_WORD_INDEX_ATTR,
  PDF_WORD_PAGE_ATTR,
} from '../types'

interface FakeItem {
  str: string
  hasEOL?: boolean
}

/**
 * Mirrors what pdfjs-dist 5.x's TextLayer does to the DOM: one absolutely
 * positioned `span[role=presentation]` per item, pushed into textDivs even
 * when empty but only APPENDED when it has text, plus a `<br>` after items
 * flagged hasEOL. The constructor also records the container's
 * `--total-scale-factor` at construction time, because the real one calls
 * setLayerDimensions() there and needs the variable to already be defined.
 */
function makeFakePdfjs(options: { fail?: boolean } = {}) {
  const constructed: { container: HTMLElement; scaleAtConstruct: string; viewport: unknown }[] = []
  class FakeTextLayer {
    textDivs: HTMLElement[] = []
    private readonly container: HTMLElement
    private readonly items: FakeItem[]
    constructor(opts: { textContentSource: unknown; container: HTMLElement; viewport: unknown }) {
      this.container = opts.container
      this.items = (opts.textContentSource as { items: FakeItem[] }).items
      constructed.push({
        container: opts.container,
        scaleAtConstruct: opts.container.style.getPropertyValue('--total-scale-factor'),
        viewport: opts.viewport,
      })
    }
    async render(): Promise<void> {
      if (options.fail) throw new Error('render failed')
      for (const item of this.items) {
        const span = document.createElement('span')
        span.setAttribute('role', 'presentation')
        span.style.left = '12.34%'
        span.style.top = '5.67%'
        span.style.setProperty('--font-height', '11.00px')
        span.textContent = item.str
        this.textDivs.push(span)
        if (item.str !== '') this.container.append(span)
        if (item.hasEOL) {
          const br = document.createElement('br')
          br.setAttribute('role', 'presentation')
          this.container.append(br)
        }
      }
    }
    cancel(): void {}
  }
  const pdfjs: PdfjsTextLayerModule = { TextLayer: FakeTextLayer }
  return { pdfjs, constructed }
}

const viewport = { scale: 1.5, rawDims: { pageWidth: 612, pageHeight: 792 } }

describe('renderPdfTextLayer', () => {
  it('appends a layer with class, page/raw-width attributes and --total-scale-factor set before TextLayer is constructed', async () => {
    const wrapper = document.createElement('div')
    const { pdfjs, constructed } = makeFakePdfjs()
    const layer = await renderPdfTextLayer(wrapper, {
      pdfjs,
      textContent: { items: [{ str: 'Hello world', hasEOL: true }] },
      viewport,
      pageNum: 7,
    })

    expect(layer.parentElement).toBe(wrapper)
    expect(layer.className).toBe(PDF_TEXT_LAYER_CLASS)
    expect(layer.getAttribute(PDF_WORD_PAGE_ATTR)).toBe('7')
    expect(layer.getAttribute(PDF_LAYER_RAW_WIDTH_ATTR)).toBe('612')
    expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('1.5')
    expect(constructed).toHaveLength(1)
    expect(constructed[0].container).toBe(layer)
    expect(constructed[0].scaleAtConstruct).toBe('1.5')
    expect(constructed[0].viewport).toBe(viewport)
  })

  it('splits every text span into sequential word spans, keeps whitespace as text nodes and preserves <br>', async () => {
    const wrapper = document.createElement('div')
    const { pdfjs } = makeFakePdfjs()
    const layer = await renderPdfTextLayer(wrapper, {
      pdfjs,
      textContent: {
        items: [
          { str: 'The quick  brown', hasEOL: true },
          { str: ' ' }, // whitespace-only: pdf.js appends it, we must not make a word of it
          { str: '', hasEOL: true }, // empty: pushed to textDivs but never appended
          { str: 'fox. (a) 2i+1' },
        ],
      },
      viewport,
      pageNum: 3,
    })

    const words = Array.from(layer.querySelectorAll<HTMLElement>(`.${PDF_WORD_CLASS}`))
    expect(words.map(w => w.textContent)).toEqual(['The', 'quick', 'brown', 'fox.', '(a)', '2i+1'])
    expect(words.map(w => w.getAttribute(PDF_WORD_INDEX_ATTR))).toEqual(['0', '1', '2', '3', '4', '5'])
    expect(words.every(w => w.getAttribute(PDF_WORD_PAGE_ATTR) === '3')).toBe(true)

    // Native selection/copy still reads naturally: the parent span's text is unchanged.
    const parents = Array.from(layer.querySelectorAll<HTMLElement>('span[role="presentation"]'))
    expect(parents[0].textContent).toBe('The quick  brown')
    expect(parents[2].textContent).toBe('fox. (a) 2i+1')
    const nodeKinds = Array.from(parents[0].childNodes).map(n => (n.nodeType === Node.TEXT_NODE ? 'text' : 'word'))
    expect(nodeKinds).toEqual(['word', 'text', 'word', 'text', 'word'])
    expect(parents[0].childNodes[3].textContent).toBe('  ')

    // The whitespace-only span is untouched and gets no word children.
    expect(parents[1].textContent).toBe(' ')
    expect(parents[1].querySelectorAll(`.${PDF_WORD_CLASS}`)).toHaveLength(0)

    // EOL markers survive so line structure is preserved for the browser.
    expect(layer.querySelectorAll('br')).toHaveLength(2)

    // Word spans carry no positioning of their own (inline children of the positioned parent).
    expect(words.every(w => w.style.left === '' && w.style.top === '' && w.style.position === '')).toBe(true)
  })

  it('rejects before touching the DOM when the viewport has no raw page width', async () => {
    const wrapper = document.createElement('div')
    const { pdfjs, constructed } = makeFakePdfjs()
    await expect(
      renderPdfTextLayer(wrapper, {
        pdfjs,
        textContent: { items: [] },
        viewport: { scale: 1, rawDims: {} },
        pageNum: 1,
      }),
    ).rejects.toThrow(/rawDims\.pageWidth/)
    expect(wrapper.childNodes).toHaveLength(0)
    expect(constructed).toHaveLength(0)
  })

  it('removes the layer and rethrows when render() rejects', async () => {
    const wrapper = document.createElement('div')
    const { pdfjs } = makeFakePdfjs({ fail: true })
    await expect(
      renderPdfTextLayer(wrapper, { pdfjs, textContent: { items: [] }, viewport, pageNum: 1 }),
    ).rejects.toThrow('render failed')
    expect(wrapper.querySelector(`.${PDF_TEXT_LAYER_CLASS}`)).toBeNull()
    expect(wrapper.childNodes).toHaveLength(0)
  })
})

describe('splitSpanIntoWords', () => {
  it('returns the word count, preserves leading/trailing whitespace and uses the index supplier', () => {
    const span = document.createElement('span')
    span.textContent = '  alpha beta\tgamma '
    let n = 10
    const created = splitSpanIntoWords(span, 2, () => n++)
    expect(created).toBe(3)
    expect(span.textContent).toBe('  alpha beta\tgamma ')
    const words = Array.from(span.querySelectorAll<HTMLElement>(`.${PDF_WORD_CLASS}`))
    expect(words.map(w => w.textContent)).toEqual(['alpha', 'beta', 'gamma'])
    expect(words.map(w => w.getAttribute(PDF_WORD_INDEX_ATTR))).toEqual(['10', '11', '12'])
    expect(span.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(span.lastChild?.nodeType).toBe(Node.TEXT_NODE)
  })

  it('leaves whitespace-only and empty spans alone and consumes no index', () => {
    const next = vi.fn(() => 0)
    const blank = document.createElement('span')
    blank.textContent = '   '
    expect(splitSpanIntoWords(blank, 1, next)).toBe(0)
    expect(blank.childNodes).toHaveLength(1)
    expect(blank.textContent).toBe('   ')

    const empty = document.createElement('span')
    expect(splitSpanIntoWords(empty, 1, next)).toBe(0)
    expect(next).not.toHaveBeenCalled()
  })
})

describe('applyPdfTextLayerScale', () => {
  it('sets --total-scale-factor to wrapperWidth / raw page width', () => {
    const layer = document.createElement('div')
    layer.setAttribute(PDF_LAYER_RAW_WIDTH_ATTR, '612')
    applyPdfTextLayerScale(layer, 918)
    expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('1.5')
    applyPdfTextLayerScale(layer, 306)
    expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('0.5')
  })

  it('ignores a missing raw width or a non-positive wrapper width', () => {
    const noRaw = document.createElement('div')
    noRaw.style.setProperty('--total-scale-factor', '2')
    applyPdfTextLayerScale(noRaw, 500)
    expect(noRaw.style.getPropertyValue('--total-scale-factor')).toBe('2')

    const layer = document.createElement('div')
    layer.setAttribute(PDF_LAYER_RAW_WIDTH_ATTR, '612')
    layer.style.setProperty('--total-scale-factor', '2')
    applyPdfTextLayerScale(layer, 0)
    expect(layer.style.getPropertyValue('--total-scale-factor')).toBe('2')
  })
})
