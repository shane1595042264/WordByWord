/**
 * PDF text layer — builds pdf.js's transparent text spans over a rendered
 * canvas page and splits each text item into one `span.pdf-word` per word.
 *
 * pdfjs-dist is NEVER imported here: it touches `DOMMatrix` at import time and
 * breaks SSR (see CLAUDE.md / NorthStar §8). The viewer lazy-imports it and
 * hands the module object in through `RenderPdfTextLayerArgs.pdfjs`, so this
 * file only types the handful of pdf.js surface it touches, structurally.
 */

import {
  PDF_LAYER_RAW_WIDTH_ATTR,
  PDF_TEXT_LAYER_CLASS,
  PDF_WORD_CLASS,
  PDF_WORD_INDEX_ATTR,
  PDF_WORD_PAGE_ATTR,
} from './types'

/**
 * The slice of pdfjs-dist 5.x this module needs; the object returned by
 * `await import('pdfjs-dist')` satisfies it (__tests__/pdfjs-compat.test.ts
 * proves this at compile time).
 *
 * The two constructor options are `any` on purpose. Under strictFunctionTypes
 * a constructor parameter is checked contravariantly, so declaring them
 * `unknown` would require pdf.js's concrete `ReadableStream | TextContent` /
 * `PageViewport` to accept `unknown` — they don't, and the real module would
 * fail to type-check against this interface. `any` is the one type that is
 * assignable both ways, and it stays confined to this boundary.
 */
export interface PdfjsTextLayerModule {
  TextLayer: new (opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    textContentSource: any
    container: HTMLElement
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    viewport: any
  }) => {
    render(): Promise<void>
    cancel(): void
    readonly textDivs: HTMLElement[]
  }
}

/** Unscaled (PDF user-space) page size — what setLayerDimensions multiplies by --total-scale-factor. */
export interface PdfRawDims {
  pageWidth: number
  pageHeight: number
}

/** The slice of a pdf.js `PageViewport` this module reads. */
export interface PdfViewportLike {
  scale: number
  /**
   * A PdfRawDims at runtime. Declared Partial because pdfjs-dist's d.ts types
   * the `rawDims` getter as the bare `Object`; a required shape would force
   * every caller to cast a real PageViewport. `renderPdfTextLayer` validates
   * `pageWidth` instead and throws a clear error if it is missing.
   */
  rawDims: Partial<PdfRawDims>
}

export interface RenderPdfTextLayerArgs {
  pdfjs: PdfjsTextLayerModule
  /** `await page.getTextContent()` (or a ReadableStream of it) — passed straight through to pdf.js. */
  textContent: unknown
  viewport: PdfViewportLike
  /** Absolute PDF page number; stamped on the layer and on every word span. */
  pageNum: number
}

/** Name of the CSS custom property pdf.js's `setLayerDimensions` multiplies the raw page size by. */
const TOTAL_SCALE_FACTOR_PROP = '--total-scale-factor'

/**
 * Build the text layer for one rendered page and append it to `wrapper` (the
 * page's `position: relative` wrapper div). Resolves to the layer element.
 *
 * Order matters here: `--total-scale-factor` must be on the layer BEFORE the
 * TextLayer is constructed, because the constructor calls
 * `setLayerDimensions(container, viewport)`, which sizes the container as
 * `calc(var(--total-scale-factor) * <rawPageWidth>px)` — with the variable
 * undefined the layer would collapse to 0×0 and every span would be
 * mispositioned. The layer is appended before rendering so the spans inherit
 * the viewer's `.pdf-text-layer` font/geometry CSS from globals.css as they
 * arrive; on failure it is removed again so a half-built layer never lingers.
 */
export async function renderPdfTextLayer(
  wrapper: HTMLElement,
  args: RenderPdfTextLayerArgs,
): Promise<HTMLDivElement> {
  const { pdfjs, textContent, viewport, pageNum } = args

  // Fail loudly before touching the DOM: without the raw width the layer could
  // never be rescaled on resize, and a silent "0" would only show up later as
  // text drifting off the glyphs.
  const rawWidth = viewport.rawDims.pageWidth
  if (typeof rawWidth !== 'number' || !(rawWidth > 0)) {
    throw new TypeError(
      'renderPdfTextLayer: viewport.rawDims.pageWidth is missing — pass the PageViewport from page.getViewport()',
    )
  }

  const layer = document.createElement('div')
  layer.className = PDF_TEXT_LAYER_CLASS
  layer.setAttribute(PDF_WORD_PAGE_ATTR, String(pageNum))
  layer.setAttribute(PDF_LAYER_RAW_WIDTH_ATTR, String(rawWidth))
  layer.style.setProperty(TOTAL_SCALE_FACTOR_PROP, String(viewport.scale))
  wrapper.appendChild(layer)

  const textLayer = new pdfjs.TextLayer({
    textContentSource: textContent,
    container: layer,
    viewport,
  })

  try {
    await textLayer.render()
  } catch (err) {
    layer.remove()
    throw err
  }

  // pdf.js pushes a span into textDivs for EVERY text item but only appends the
  // ones with non-empty text (`hasText`), so textDivs can contain detached,
  // empty spans. Splitting skips whitespace-only spans, which covers those too.
  // Word indices are per page and run in content-stream (DOM) order, which is
  // the order the cursor walks.
  let nextWordIndex = 0
  const nextIndex = () => nextWordIndex++
  for (const span of textLayer.textDivs) {
    splitSpanIntoWords(span, pageNum, nextIndex)
  }

  // The canvas is displayed at width:100% of the wrapper, so if the wrapper's
  // CSS width differs from the render-time pixel width (e.g. the pane was
  // resized while the page was rendering), re-derive the factor from what is
  // actually on screen. jsdom reports 0 here, hence the guard.
  if (wrapper.clientWidth > 0) {
    applyPdfTextLayerScale(layer, wrapper.clientWidth)
  }

  return layer
}

/**
 * Replace a pdf.js text span's text with one `span.pdf-word` per
 * whitespace-delimited token. Whitespace runs are kept as bare text nodes
 * between the word spans so the browser's native selection / copy still
 * reads "a b c" rather than "abc". Returns the number of words created.
 *
 * Word spans deliberately carry no positioning of their own: pdf.js positions
 * the PARENT span absolutely (left/top in %, --font-height, --scale-x), and the
 * words must flow inline inside it so they inherit that placement and the
 * parent's horizontal scaling. The viewer's CSS styles `.pdf-word`.
 *
 * Tokenization is `split(/\s+/)`: punctuation stays attached ("tree.", "(a)",
 * "2i+1"), matching how NibParser tokenizes text view.
 */
export function splitSpanIntoWords(
  span: HTMLElement,
  pageNum: number,
  nextIndex: () => number,
): number {
  const text = span.textContent ?? ''
  if (text.trim() === '') return 0

  // Capturing group keeps the separators in the result so they can be
  // re-emitted verbatim as text nodes.
  const parts = text.split(/(\s+)/)
  span.textContent = ''

  let created = 0
  for (const part of parts) {
    if (part === '') continue
    if (/^\s+$/.test(part)) {
      span.appendChild(document.createTextNode(part))
      continue
    }
    const word = document.createElement('span')
    word.className = PDF_WORD_CLASS
    word.setAttribute(PDF_WORD_INDEX_ATTR, String(nextIndex()))
    word.setAttribute(PDF_WORD_PAGE_ATTR, String(pageNum))
    word.textContent = part
    span.appendChild(word)
    created++
  }
  return created
}

/**
 * Re-derive `--total-scale-factor` from the wrapper's current CSS width so the
 * layer keeps tracking a canvas that is CSS-scaled to `width: 100%`.
 *
 * The viewer renders each canvas at `scale = containerWidth / rawPageWidth`
 * and then lets CSS stretch it to the wrapper. When the pane is resized the
 * canvas follows for free, but the text layer's size is
 * `var(--total-scale-factor) * rawPageWidth`, so the factor must be refreshed
 * to `wrapperWidth / rawPageWidth` or the spans drift off the glyphs. The raw
 * width is read from the attribute stamped at render time, so callers need
 * only the layer and the new width (a ResizeObserver callback has both).
 */
export function applyPdfTextLayerScale(layer: HTMLElement, wrapperWidth: number): void {
  const rawWidth = Number(layer.getAttribute(PDF_LAYER_RAW_WIDTH_ATTR))
  if (!(rawWidth > 0) || !(wrapperWidth > 0)) return
  layer.style.setProperty(TOTAL_SCALE_FACTOR_PROP, String(wrapperWidth / rawWidth))
}
