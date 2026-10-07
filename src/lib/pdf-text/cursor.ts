/**
 * PdfTextCursor — a word-level vim cursor over the PDF text layer.
 *
 * The reader page already drives NibTextViewer's imperative handle from the
 * vim engine (src/lib/vim/use-vim-mode.ts). This class exposes the same
 * surface (PdfTextCursorHandle) over the `span.pdf-word` elements that
 * text-layer.ts creates, so the page can dispatch each vim callback to
 * whichever pane is on screen without caring which one it is.
 *
 * Design notes
 * - Framework-free: the viewer owns the DOM and calls `refresh()` after each
 *   lazily-rendered page lands. Nothing here is cached across calls except the
 *   word list itself; geometry is always read fresh via getBoundingClientRect,
 *   because the canvas (and therefore the text layer) is CSS-scaled and can
 *   move under us at any time.
 * - Cursor, anchor and highlights are stored as ELEMENTS, not flat indices.
 *   Pages render lazily, so a page inserted above the cursor shifts every flat
 *   index; keying on elements lets `refresh()` keep the reader exactly where
 *   they were and simply recompute the numbers.
 * - Scrolling only ever touches `container.scrollTop`. `scrollIntoView()`
 *   walks up every scrollable ancestor and would yank the whole reader page
 *   around when the PDF pane sits inside a split layout.
 */

import { findSentenceIndex, splitWordsIntoSentences, type SentenceRange } from './sentences'
import {
  PDF_WORD_CLASS,
  PDF_WORD_CURSOR_CLASS,
  PDF_WORD_PAGE_ATTR,
  PDF_WORD_SELECTED_CLASS,
  type PdfSelectionInfo,
  type PdfTextCursorCallbacks,
  type PdfTextCursorHandle,
  type PdfVimMode,
  type PdfWordRef,
} from './types'

/** Keep this many CSS px of context between the cursor word and the viewport edge when nudging it into view. */
const SCROLL_PADDING_PX = 48
/** How much of the viewport to scroll when j/k finds no word in that direction (blank or unrendered space). */
const BLANK_SCROLL_FRACTION = 0.25
/** Fraction of the cursor word's height a candidate's centre must clear to count as "on another line" (NibTextViewer's value). */
const LINE_THRESHOLD_FRACTION = 0.4
/** Two words share a visual line when their vertical centres are within this fraction of the cursor word's height. */
const SAME_LINE_FRACTION = 0.5
/** Vertical distance is weighted this much more than horizontal when picking the nearest word on the next line. */
const VERTICAL_WEIGHT = 3

/** Contiguous run of flat indices belonging to one page, in DOM order. */
interface PageRun {
  pageNum: number
  start: number
  /** Exclusive. */
  end: number
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

export class PdfTextCursor implements PdfTextCursorHandle {
  private readonly container: HTMLElement
  private readonly callbacks: PdfTextCursorCallbacks

  private _words: PdfWordRef[] = []
  /** Element → flat index; rebuilt on every refresh(). */
  private indexOf = new Map<HTMLElement, number>()
  private pageRuns: PageRun[] = []
  private sentences: SentenceRange[] = []

  private _mode: PdfVimMode = 'normal'
  private cursorEl: HTMLElement | null = null
  /** Visual-mode anchor; null outside visual mode. */
  private anchorEl: HTMLElement | null = null
  private highlightEls = new Set<HTMLElement>()

  /** What currently carries the classes, so applyClasses() can diff and never leak a class. */
  private appliedCursorEl: HTMLElement | null = null
  private appliedHighlightEls = new Set<HTMLElement>()

  /** Outstanding gg/G edge request (see requestEdgeSelection). */
  private pendingEdge: 1 | -1 | null = null
  private pendingEdgeCleanup: (() => void) | null = null

  private disposed = false

  constructor(container: HTMLElement, callbacks: PdfTextCursorCallbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    // Delegated: word spans come and go as pages render, so listen once on the
    // container rather than on each span.
    container.addEventListener('click', this.handleClick)
    this.refresh()
  }

  // ───────────────────────────── public extras ─────────────────────────────

  /** Every word currently in the DOM, in reading order. */
  get words(): readonly PdfWordRef[] {
    return this._words
  }

  get mode(): PdfVimMode {
    return this._mode
  }

  /**
   * Rescan the container for `.pdf-word` spans and rebuild the flat word list
   * and sentence ranges. The cursor stays on the same element if it is still
   * attached (its flat index may change); if its element is gone the old
   * flat index is clamped onto the new list. Highlights on detached elements
   * are dropped. Classes are re-applied. Fires onChange only if the cursor's
   * element or index actually changed.
   */
  refresh(): void {
    if (this.disposed) return
    const prevEl = this.cursorEl
    const prevIndex = this.cursorIndex()

    const spans = this.container.querySelectorAll<HTMLElement>(`.${PDF_WORD_CLASS}`)
    const words: PdfWordRef[] = []
    const indexOf = new Map<HTMLElement, number>()
    const pageRuns: PageRun[] = []

    spans.forEach((el, index) => {
      const pageNum = readPageNum(el)
      words.push({ el, text: (el.textContent ?? '').trim(), pageNum, index })
      indexOf.set(el, index)
      const last = pageRuns[pageRuns.length - 1]
      if (last && last.pageNum === pageNum) last.end = index + 1
      else pageRuns.push({ pageNum, start: index, end: index + 1 })
    })

    this._words = words
    this.indexOf = indexOf
    this.pageRuns = pageRuns
    this.sentences = splitWordsIntoSentences(words.map(w => w.text))

    if (this.cursorEl && !indexOf.has(this.cursorEl)) {
      // The page under the cursor was replaced (section change, re-render):
      // fall back to the nearest surviving flat position rather than losing
      // the reader's place entirely.
      this.cursorEl = words.length > 0 ? words[clamp(prevIndex, 0, words.length - 1)].el : null
    }
    for (const el of this.highlightEls) {
      if (!indexOf.has(el)) this.highlightEls.delete(el)
    }
    if (this.anchorEl && !indexOf.has(this.anchorEl)) {
      // Lost anchor: re-anchor at the cursor so the next visual motion still extends from somewhere sensible.
      this.anchorEl = this.cursorEl
    }

    this.applyClasses()
    if (this.cursorEl !== prevEl || this.cursorIndex() !== prevIndex) this.emitChange()
    // A newly rendered edge page may be what a pending gg/G was waiting for.
    this.resolvePendingEdge()
  }

  /** Remove the click listener and every class this cursor added. The instance is inert afterwards. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelPendingEdge()
    this.container.removeEventListener('click', this.handleClick)
    this.cursorEl = null
    this.anchorEl = null
    this.highlightEls.clear()
    this.applyClasses()
    this._words = []
    this.indexOf.clear()
    this.pageRuns = []
    this.sentences = []
  }

  // ─────────────────────────── PdfTextCursorHandle ───────────────────────────

  selectWordByDelta(delta: number): void {
    if (this._words.length === 0) return
    this.cancelPendingEdge()
    let next: number
    if (delta === 0 || this.cursorIndex() < 0) {
      // No cursor yet: a first h/l should start from what the reader is
      // looking at, not from word 0 of whichever page rendered first.
      next = this.firstVisibleIndex()
    } else {
      // With no cursor yet, -1 + delta still clamps sensibly: `l` lands on word
      // 0, gg's -999999 on 0, G's +999999 on the last word.
      next = clamp(this.cursorIndex() + delta, 0, this._words.length - 1)
    }
    this.placeCursor(next)
    this.scrollWordIntoView(this._words[next].el)
    this.applyClasses()
    this.emitChange()
  }

  selectSentenceByDelta(delta: number): void {
    if (this.sentences.length === 0) return
    let sentenceIdx: number
    if (delta === 0) {
      sentenceIdx = findSentenceIndex(this.sentences, this.firstVisibleIndex())
    } else {
      // The sentence cursor is derived from the word cursor (which always sits
      // on the sentence's first word after a sentence motion) rather than kept
      // separately, so it survives refresh() re-indexing for free.
      const cur = this.cursorIndex()
      const base = findSentenceIndex(this.sentences, cur >= 0 ? cur : this.firstVisibleIndex())
      sentenceIdx = clamp(base + delta, 0, this.sentences.length - 1)
    }
    if (sentenceIdx < 0) sentenceIdx = 0
    this.selectSentence(sentenceIdx)
  }

  selectCurrentLine(): void {
    if (this._words.length === 0) return
    let cur = this.cursorIndex()
    if (cur < 0) cur = this.firstVisibleIndex()

    const curWord = this._words[cur]
    const curRect = curWord.el.getBoundingClientRect()
    const curCenterY = curRect.top + curRect.height / 2
    const tolerance = curRect.height * SAME_LINE_FRACTION

    // Only the cursor's own page can hold its line; adjacent pages are laid out
    // below/above, never beside.
    const lineIndices: number[] = []
    for (const run of this.pageRuns) {
      if (run.pageNum !== curWord.pageNum) continue
      for (let i = run.start; i < run.end; i++) {
        const rect = this._words[i].el.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        if (Math.abs(centerY - curCenterY) <= tolerance) lineIndices.push(i)
      }
    }
    if (lineIndices.length === 0) lineIndices.push(cur)

    this.highlightEls.clear()
    for (const i of lineIndices) this.highlightEls.add(this._words[i].el)
    const first = this._words[lineIndices[0]].el
    this.cursorEl = first
    // `V` enters visual mode (anchor = the old cursor, possibly mid-line) and
    // then selects the line. Re-anchoring at the line's first word means the
    // next l/j extends FROM the line start instead of collapsing the highlight
    // back to a sub-range between the old cursor and the new one.
    if (this._mode === 'visual') this.anchorEl = first

    this.scrollWordIntoView(first)
    this.applyClasses()
    this.emitChange()
  }

  selectToEnd(): void {
    if (this._words.length === 0) return
    const cur = this.cursorIndex()
    const from = cur >= 0 ? cur : this.firstVisibleIndex()
    const last = this._words.length - 1
    // Union, not replace: `V` then `G` should keep the already-selected line.
    for (let i = from; i <= last; i++) this.highlightEls.add(this._words[i].el)
    this.cursorEl = this._words[last].el
    this.scrollWordIntoView(this.cursorEl)
    this.applyClasses()
    this.emitChange()
  }

  selectToStart(): void {
    if (this._words.length === 0) return
    const cur = this.cursorIndex()
    const to = cur >= 0 ? cur : this.firstVisibleIndex()
    for (let i = 0; i <= to; i++) this.highlightEls.add(this._words[i].el)
    this.cursorEl = this._words[0].el
    this.scrollWordIntoView(this.cursorEl)
    this.applyClasses()
    this.emitChange()
  }

  /**
   * Drop every highlight and the visual anchor, keep the cursor. The cursor
   * class stays so the reader can still see where they are after Escape — the
   * next h/l continues from there, exactly like text view.
   */
  clearVimSelection(): void {
    this.highlightEls.clear()
    this.anchorEl = null
    this.applyClasses()
    this.callbacks.onClear?.()
  }

  confirmSelection(): void {
    const cur = this.cursorIndex()
    if (cur < 0) return
    const word = this._words[cur]
    const sentenceIdx = findSentenceIndex(this.sentences, cur)
    // A word outside every range cannot happen with contiguous ranges, but if
    // it ever does the word is its own sentence rather than a crash.
    const range = sentenceIdx >= 0 ? this.sentences[sentenceIdx] : { start: cur, end: cur + 1 }
    const sentenceWords = this._words.slice(range.start, range.end).map(w => w.text)
    const info: PdfSelectionInfo = {
      text: this.getSelectedText(),
      sentenceText: sentenceWords.join(' '),
      sentenceWords,
      wordIndexInSentence: cur - range.start,
      anchorEl: word.el,
      pageNum: word.pageNum,
      mode: this._mode,
    }
    this.callbacks.onConfirm?.(info)
  }

  selectWordVertical(direction: number): void {
    if (this._words.length === 0 || direction === 0) return
    const cur = this.cursorIndex()
    if (cur < 0) {
      // Nothing to move from yet: land on the first visible word, like delta=0.
      this.selectWordByDelta(0)
      return
    }

    const curWord = this._words[cur]
    const curRect = curWord.el.getBoundingClientRect()
    const curCenterX = curRect.left + curRect.width / 2
    const curCenterY = curRect.top + curRect.height / 2
    const lineThreshold = curRect.height * LINE_THRESHOLD_FRACTION

    // Candidates are bounded to the cursor's page and its neighbours: a word
    // two pages away can never be "the next line", and a long book would
    // otherwise cost a layout read per word per keypress.
    let bestIndex = -1
    let bestDistance = Infinity
    for (const run of this.pageRuns) {
      if (Math.abs(run.pageNum - curWord.pageNum) > 1) continue
      for (let i = run.start; i < run.end; i++) {
        if (i === cur) continue
        const rect = this._words[i].el.getBoundingClientRect()
        const centerY = rect.top + rect.height / 2
        if (direction > 0 && centerY <= curCenterY + lineThreshold) continue
        if (direction < 0 && centerY >= curCenterY - lineThreshold) continue
        const distance =
          Math.abs(centerY - curCenterY) * VERTICAL_WEIGHT +
          Math.abs(rect.left + rect.width / 2 - curCenterX)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }
    }

    if (bestIndex >= 0) {
      this.placeCursor(bestIndex)
      this.scrollWordIntoView(this._words[bestIndex].el)
      this.applyClasses()
      this.emitChange()
      return
    }

    // No word in that direction on this or the neighbouring page. Pages render
    // lazily, so the "next line" may simply not exist yet: scroll a quarter
    // viewport so the viewer renders it and the next j/k can land on it.
    this.scrollContainerBy(direction * Math.round(this.container.clientHeight * BLANK_SCROLL_FRACTION))
  }

  selectSentenceVertical(direction: number): void {
    if (this.sentences.length === 0 || direction === 0) return
    const cur = this.cursorIndex()
    if (cur < 0) {
      this.selectSentenceByDelta(0)
      return
    }

    const curSentenceIdx = findSentenceIndex(this.sentences, cur)
    // Measure from the current sentence's first word (NibTextViewer does the
    // same) so repeated j/k steps line-by-line through sentence starts.
    const refIndex = curSentenceIdx >= 0 ? this.sentences[curSentenceIdx].start : cur
    const refWord = this._words[refIndex]
    const refRect = refWord.el.getBoundingClientRect()
    const refCenterY = refRect.top + refRect.height / 2
    const lineThreshold = refRect.height * LINE_THRESHOLD_FRACTION

    let bestSentence = -1
    let bestDistance = Infinity
    for (let si = 0; si < this.sentences.length; si++) {
      if (si === curSentenceIdx) continue
      const firstWord = this._words[this.sentences[si].start]
      if (Math.abs(firstWord.pageNum - refWord.pageNum) > 1) continue
      const rect = firstWord.el.getBoundingClientRect()
      const centerY = rect.top + rect.height / 2
      if (direction > 0 && centerY <= refCenterY + lineThreshold) continue
      if (direction < 0 && centerY >= refCenterY - lineThreshold) continue
      const distance = Math.abs(centerY - refCenterY)
      if (distance < bestDistance) {
        bestDistance = distance
        bestSentence = si
      }
    }

    if (bestSentence >= 0) {
      this.selectSentence(bestSentence)
      return
    }
    // Same reasoning as selectWordVertical: the next sentence may be on a page
    // that has not rendered yet.
    this.scrollContainerBy(direction * Math.round(this.container.clientHeight * BLANK_SCROLL_FRACTION))
  }

  getSelectedText(): string {
    if (this.highlightEls.size > 0) {
      const indices: number[] = []
      for (const el of this.highlightEls) {
        const i = this.indexOf.get(el)
        if (i !== undefined) indices.push(i)
      }
      indices.sort((a, b) => a - b)
      return indices.map(i => this._words[i].text).filter(Boolean).join(' ')
    }
    const cur = this.cursorIndex()
    return cur >= 0 ? this._words[cur].text : ''
  }

  getVimCursorIndex(): number {
    return this.cursorIndex()
  }

  selectWordByIndex(index: number): void {
    if (this._words.length === 0) return
    const clamped = clamp(index, 0, this._words.length - 1)
    this.highlightEls.clear()
    this.cursorEl = this._words[clamped].el
    // A jump (restore / search hit) centres the word; motions only nudge.
    this.scrollWordIntoView(this.cursorEl, true)
    this.applyClasses()
    this.emitChange()
  }

  /** Cursor on the first word inside the viewport, without scrolling; false when nothing is on screen yet. */
  placeOnFirstVisibleWord(): boolean {
    if (this.disposed || this._words.length === 0) return false
    const visible = this.visibleIndices()
    if (visible.length === 0) return false
    this.cursorEl = this._words[visible[0]].el
    this.applyClasses()
    this.emitChange()
    return true
  }

  /**
   * gg / G from the vim engine, which has already started a smooth scroll to
   * the pane's edge. Resolve once the scroll settles (`scrollend`, with a
   * timer fallback) or when a later `refresh()` brings the edge page's words
   * in — whichever first finds a visible word. Never scrolls itself.
   */
  requestEdgeSelection(direction: 1 | -1): void {
    if (this.disposed) return
    this.cancelPendingEdge()
    this.pendingEdge = direction
    const onSettle = () => this.resolvePendingEdge()
    this.container.addEventListener('scrollend', onSettle)
    const timer = setTimeout(onSettle, 700)
    this.pendingEdgeCleanup = () => {
      this.container.removeEventListener('scrollend', onSettle)
      clearTimeout(timer)
    }
  }

  private cancelPendingEdge(): void {
    this.pendingEdge = null
    this.pendingEdgeCleanup?.()
    this.pendingEdgeCleanup = null
  }

  private resolvePendingEdge(): void {
    const direction = this.pendingEdge
    if (direction === null || this.disposed) return
    const visible = this.visibleIndices()
    if (visible.length === 0) return // edge page not rendered yet — refresh() will retry
    const index = direction > 0 ? visible[visible.length - 1] : visible[0]
    this.cancelPendingEdge()
    this.placeCursor(index)
    this.applyClasses()
    this.emitChange()
  }

  /** Flat indices of words whose box intersects the container's viewport, in reading order. */
  private visibleIndices(): number[] {
    const containerRect = this.container.getBoundingClientRect()
    const out: number[] = []
    for (let i = 0; i < this._words.length; i++) {
      const rect = this._words[i].el.getBoundingClientRect()
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) out.push(i)
    }
    return out
  }

  setMode(mode: PdfVimMode): void {
    const prev = this._mode
    this._mode = mode
    if (mode === 'visual') {
      if (prev !== 'visual') {
        this.anchorEl = this.cursorEl ?? this._words[0]?.el ?? null
      }
    } else {
      this.anchorEl = null
    }
    if (mode === 'normal' && prev === 'sentence') {
      this.highlightEls.clear()
      this.applyClasses()
    }
  }

  // ──────────────────────────────── internals ────────────────────────────────

  private cursorIndex(): number {
    return this.cursorEl ? (this.indexOf.get(this.cursorEl) ?? -1) : -1
  }

  /**
   * Move the cursor to a flat index. In visual mode with a live anchor the
   * highlight becomes the inclusive anchor..cursor range; otherwise any
   * highlight is dropped (a plain motion in normal mode deselects a sentence,
   * as in text view).
   */
  private placeCursor(index: number): void {
    const el = this._words[index].el
    this.cursorEl = el
    if (this._mode === 'visual') {
      const anchor = this.anchorEl ? this.indexOf.get(this.anchorEl) : undefined
      if (anchor !== undefined) {
        this.highlightEls.clear()
        const lo = Math.min(anchor, index)
        const hi = Math.max(anchor, index)
        for (let i = lo; i <= hi; i++) this.highlightEls.add(this._words[i].el)
        return
      }
      // Visual mode entered with no words yet: anchor here so the next motion extends.
      this.anchorEl = el
    }
    this.highlightEls.clear()
  }

  /** Highlight every word of a sentence, put the cursor on its first word, scroll, notify. */
  private selectSentence(sentenceIdx: number): void {
    const range = this.sentences[sentenceIdx]
    if (!range || range.end <= range.start) return
    this.highlightEls.clear()
    for (let i = range.start; i < range.end; i++) this.highlightEls.add(this._words[i].el)
    this.cursorEl = this._words[range.start].el
    this.scrollWordIntoView(this.cursorEl)
    this.applyClasses()
    this.emitChange()
  }

  /**
   * First word whose top edge lies inside the container's viewport. If none
   * does (e.g. the reader scrolled into a gap between pages), the word nearest
   * below the viewport top, else 0.
   */
  private firstVisibleIndex(): number {
    if (this._words.length === 0) return -1
    const containerRect = this.container.getBoundingClientRect()
    let nearestBelow = -1
    let nearestBelowTop = Infinity
    for (let i = 0; i < this._words.length; i++) {
      const top = this._words[i].el.getBoundingClientRect().top
      if (top >= containerRect.top && top < containerRect.bottom) return i
      if (top >= containerRect.bottom && top < nearestBelowTop) {
        nearestBelowTop = top
        nearestBelow = i
      }
    }
    return nearestBelow >= 0 ? nearestBelow : 0
  }

  /**
   * Container-relative scroll. Nudges `scrollTop` by exactly the overshoot
   * past a 48px inner margin, or centres the word when `center` is set.
   * Instant on purpose: the vim engine fires several motions per count and a
   * smooth scroll would still be in flight when the next rect is read.
   */
  private scrollWordIntoView(el: HTMLElement, center = false): void {
    const container = this.container
    const containerRect = container.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    if (center) {
      const centerInViewport = rect.top - containerRect.top + rect.height / 2
      container.scrollTop += centerInViewport - container.clientHeight / 2
      return
    }
    const minTop = containerRect.top + SCROLL_PADDING_PX
    const maxBottom = containerRect.bottom - SCROLL_PADDING_PX
    if (rect.top < minTop) {
      container.scrollTop -= minTop - rect.top
    } else if (rect.bottom > maxBottom) {
      container.scrollTop += rect.bottom - maxBottom
    }
  }

  /** `scrollBy` is absent in some test DOMs; fall back to a direct scrollTop write. */
  private scrollContainerBy(top: number): void {
    const container = this.container
    if (typeof container.scrollBy === 'function') {
      container.scrollBy({ top })
    } else {
      container.scrollTop += top
    }
  }

  /** Diff the desired cursor/highlight elements against what currently carries the classes. */
  private applyClasses(): void {
    if (this.appliedCursorEl !== this.cursorEl) {
      this.appliedCursorEl?.classList.remove(PDF_WORD_CURSOR_CLASS)
      this.cursorEl?.classList.add(PDF_WORD_CURSOR_CLASS)
      this.appliedCursorEl = this.cursorEl
    }
    for (const el of this.appliedHighlightEls) {
      if (!this.highlightEls.has(el)) el.classList.remove(PDF_WORD_SELECTED_CLASS)
    }
    for (const el of this.highlightEls) {
      if (!this.appliedHighlightEls.has(el)) el.classList.add(PDF_WORD_SELECTED_CLASS)
    }
    this.appliedHighlightEls = new Set(this.highlightEls)
  }

  private emitChange(): void {
    const cur = this.cursorIndex()
    this.callbacks.onChange?.(cur >= 0 ? this._words[cur] : null)
  }

  /**
   * Click on a word: move the cursor there (extend in visual mode) and open
   * the info panel, matching text view. A non-collapsed native selection means
   * the reader just drag-selected — the click that ends a drag must not snap
   * the cursor and destroy what they selected.
   */
  private readonly handleClick = (event: MouseEvent): void => {
    if (this.disposed) return
    const selection = typeof window !== 'undefined' ? window.getSelection?.() : null
    if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return

    const node = event.target as Node | null
    const target = node instanceof Element ? node : node?.parentElement ?? null
    const wordEl = target?.closest<HTMLElement>(`.${PDF_WORD_CLASS}`) ?? null
    if (!wordEl) return

    let index = this.indexOf.get(wordEl)
    if (index === undefined) {
      // A page rendered and the viewer has not refreshed yet — rescan instead of ignoring the click.
      this.refresh()
      index = this.indexOf.get(wordEl)
      if (index === undefined) return
    }

    this.placeCursor(index)
    this.applyClasses()
    this.emitChange()
    this.confirmSelection()
  }
}

/** Page number stamped by text-layer.ts, falling back to the enclosing `[data-page-num]` wrapper. */
function readPageNum(el: HTMLElement): number {
  const own = Number(el.getAttribute(PDF_WORD_PAGE_ATTR))
  if (Number.isFinite(own) && own > 0) return own
  const wrapper = el.closest<HTMLElement>('[data-page-num]')
  const fromWrapper = Number(wrapper?.dataset.pageNum)
  return Number.isFinite(fromWrapper) && fromWrapper > 0 ? fromWrapper : 0
}
