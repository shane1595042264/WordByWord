/**
 * PDF text layer + vim cursor — shared contract.
 *
 * PDF view used to render bare canvases, so nothing on the page was
 * selectable and the vim engine had nothing to move a cursor over. The text
 * layer (text-layer.ts) draws pdf.js's transparent text spans over each
 * canvas and splits every text item into one span per word; the cursor
 * (cursor.ts) drives a word-level vim cursor over those spans, mirroring the
 * NibTextViewer handle so the reader page can dispatch the same vim callbacks
 * to whichever pane is on screen.
 */

/** Class of the per-page text layer element (absolute, over the canvas). */
export const PDF_TEXT_LAYER_CLASS = 'pdf-text-layer'
/** Class of one word span inside the text layer. */
export const PDF_WORD_CLASS = 'pdf-word'
/** Added to the word span under the vim cursor. */
export const PDF_WORD_CURSOR_CLASS = 'pdf-word-cursor'
/** Added to every word span in the current sentence / visual / line selection. */
export const PDF_WORD_SELECTED_CLASS = 'pdf-word-selected'
/** data-* attribute on a word span: 0-based index of the word within its page's text layer. */
export const PDF_WORD_INDEX_ATTR = 'data-pdf-word'
/** data-* attribute on a word span and on the layer: the absolute PDF page number. */
export const PDF_WORD_PAGE_ATTR = 'data-pdf-page'
/** data-* attribute on the layer: the unscaled (PDF user-space) page width, for resize rescaling. */
export const PDF_LAYER_RAW_WIDTH_ATTR = 'data-raw-width'

export type PdfVimMode = 'normal' | 'sentence' | 'visual'

/** One word in the text layer, in DOM (content-stream) order across rendered pages. */
export interface PdfWordRef {
  el: HTMLElement
  /** Word text as printed, punctuation attached ("tree.", "(a)") */
  text: string
  pageNum: number
  /** Flat index across every currently rendered page, in DOM order */
  index: number
}

/** What the cursor hands back when the reader confirms (Enter) or clicks a word. */
export interface PdfSelectionInfo {
  /** Clean text of the selection: the cursor word, the sentence, or the visual/line range */
  text: string
  /** Text of the sentence containing the cursor word */
  sentenceText: string
  /** Words of that sentence, in order */
  sentenceWords: string[]
  /** 0-based index of the cursor word within sentenceWords */
  wordIndexInSentence: number
  /** Element to anchor the info panel to (the cursor word span) */
  anchorEl: HTMLElement
  pageNum: number
  mode: PdfVimMode
}

export interface PdfTextCursorCallbacks {
  /** Enter in normal/sentence mode, or a click on a word: show the info panel. */
  onConfirm?: (sel: PdfSelectionInfo) => void
  /** Escape / clearVimSelection: close the panel. */
  onClear?: () => void
  /** After any cursor or selection change. `null` when nothing is selected. */
  onChange?: (cursor: PdfWordRef | null) => void
}

/**
 * Imperative surface the reader page's vim callbacks dispatch to in PDF view.
 * Method names and semantics mirror NibTextViewerHandle so the page can treat
 * the two panes interchangeably.
 */
export interface PdfTextCursorHandle {
  /** Move the cursor by delta words. delta=0 → first visible word (mode entry / restore). */
  selectWordByDelta: (delta: number) => void
  /** Move the sentence cursor by delta sentences, highlighting the whole sentence. delta=0 → first visible sentence. */
  selectSentenceByDelta: (delta: number) => void
  /** Highlight every word on the cursor's visual line; cursor moves to its first word. */
  selectCurrentLine: () => void
  /** Extend the highlight from the cursor to the last rendered word. */
  selectToEnd: () => void
  /** Extend the highlight from the cursor to the first rendered word. */
  selectToStart: () => void
  /** Drop every highlight and the visual anchor (the cursor stays visible, like text view); fires onClear. */
  clearVimSelection: () => void
  /** Fire onConfirm for the current selection (Enter). */
  confirmSelection: () => void
  /** Move the cursor to the nearest word on the line below (1) / above (-1). */
  selectWordVertical: (direction: number) => void
  /** Move the sentence cursor to the sentence whose first word is on the nearest line below/above. */
  selectSentenceVertical: (direction: number) => void
  /** Clean text of the current selection (highlight range, else the cursor word, else ''). */
  getSelectedText: () => string
  /** Flat index of the cursor word (-1 when none). */
  getVimCursorIndex: () => number
  /** Put the cursor on a flat word index (clamped) and scroll it into view. */
  selectWordByIndex: (index: number) => void
  /** Tell the cursor which vim mode is active. Entering 'visual' anchors the range at the cursor. */
  setMode: (mode: PdfVimMode) => void
  /**
   * Put the cursor on the first word inside the pane's viewport WITHOUT
   * scrolling. Returns false (and leaves the cursor where it was) when no
   * word is on screen yet — the viewer calls this after each lazily rendered
   * page so the cursor appears once the page the reader is looking at lands,
   * and never drags the pane to an off-screen page.
   */
  placeOnFirstVisibleWord: () => boolean
  /**
   * gg / G: the vim engine has already started a smooth scroll to the top or
   * bottom of the pane. Pages render lazily, so moving the cursor now would
   * clamp it to the last RENDERED word and its scroll-into-view would abort
   * that scroll. Instead, remember the request and land on the first (-1) or
   * last (1) visible word once the scroll has settled and the edge page's
   * words exist (resolved from `scrollend` and from `refresh()`). Any other
   * motion cancels the pending request.
   */
  requestEdgeSelection: (direction: 1 | -1) => void
}
