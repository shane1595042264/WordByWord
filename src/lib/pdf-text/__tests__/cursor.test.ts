import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { PdfTextCursor } from '../cursor'
import {
  PDF_TEXT_LAYER_CLASS,
  PDF_WORD_CLASS,
  PDF_WORD_CURSOR_CLASS,
  PDF_WORD_INDEX_ATTR,
  PDF_WORD_PAGE_ATTR,
  PDF_WORD_SELECTED_CLASS,
  type PdfSelectionInfo,
  type PdfWordRef,
} from '../types'

// ─── Fake layout ─────────────────────────────────────────────────────────────
//
// Two pages, 3 lines × 4 words each. Page p (1-based) starts at y = (p-1)*200;
// line L is at y = pageTop + 20 + L*40; word w sits at x = 10 + w*60, 50 wide,
// 20 tall. Rects are computed from the table minus the container's current
// scrollTop, so writing scrollTop behaves like a real scroll.

const WORD_W = 50
const WORD_H = 20
const PAGE_H = 200
const PAGE_TEXT: Record<number, string[]> = {
  1: ['The', 'quick', 'brown', 'fox.', 'Jumps', 'over', 'the', 'lazy', 'dog.', 'Dr.', 'Smith', 'arrived'],
  2: ['late!', '"Hello', 'there,"', 'she', 'said.', 'It', 'was', '3', "o'clock.", 'Fin', 'end', 'here.'],
}
// Expected sentence ranges over the 24 flat words (see PAGE_TEXT):
//   [0,4) The quick brown fox.     [4,9) Jumps over the lazy dog.
//   [9,13) Dr. Smith arrived late! [13,17) "Hello there," she said.
//   [17,21) It was 3 o'clock.      [21,24) Fin end here.

function domRect(x: number, y: number, w: number, h: number): DOMRect {
  return { x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, toJSON: () => ({}) } as DOMRect
}

interface Fixture {
  container: HTMLElement
  scrollBy: Mock<(opts: ScrollToOptions) => void>
  wordEls: () => HTMLElement[]
  buildPage: (pageNum: number) => HTMLElement
}

function wordPosition(pageNum: number, wordInPage: number) {
  const line = Math.floor(wordInPage / 4)
  const col = wordInPage % 4
  return { x: 10 + col * 60, y: (pageNum - 1) * PAGE_H + 20 + line * 40 }
}

function makeFixture(opts: { pages?: number[]; viewportHeight?: number } = {}): Fixture {
  const viewportHeight = opts.viewportHeight ?? 600
  const container = document.createElement('div')
  Object.defineProperty(container, 'clientHeight', { value: viewportHeight, configurable: true })
  // Like a real element: writable, instant, never negative.
  let scrollTop = 0
  Object.defineProperty(container, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => { scrollTop = Math.max(0, v) },
    configurable: true,
  })
  const scrollBy = vi.fn<(opts: ScrollToOptions) => void>()
  ;(container as unknown as { scrollBy: unknown }).scrollBy = scrollBy
  container.getBoundingClientRect = () => domRect(0, 0, 800, viewportHeight)
  document.body.appendChild(container)

  const buildPage = (pageNum: number): HTMLElement => {
    const wrapper = document.createElement('div')
    wrapper.dataset.pageNum = String(pageNum)
    const layer = document.createElement('div')
    layer.className = PDF_TEXT_LAYER_CLASS
    layer.setAttribute(PDF_WORD_PAGE_ATTR, String(pageNum))
    wrapper.appendChild(layer)
    // One pdf.js text span per line, words inside separated by whitespace text nodes.
    const texts = PAGE_TEXT[pageNum]
    for (let line = 0; line < 3; line++) {
      const lineSpan = document.createElement('span')
      lineSpan.setAttribute('role', 'presentation')
      for (let col = 0; col < 4; col++) {
        const i = line * 4 + col
        if (col > 0) lineSpan.appendChild(document.createTextNode(' '))
        const w = document.createElement('span')
        w.className = PDF_WORD_CLASS
        w.setAttribute(PDF_WORD_INDEX_ATTR, String(i))
        w.setAttribute(PDF_WORD_PAGE_ATTR, String(pageNum))
        w.textContent = texts[i]
        const pos = wordPosition(pageNum, i)
        w.getBoundingClientRect = () => domRect(pos.x, pos.y - container.scrollTop, WORD_W, WORD_H)
        lineSpan.appendChild(w)
      }
      layer.appendChild(lineSpan)
    }
    return wrapper
  }

  for (const p of opts.pages ?? [1, 2]) container.appendChild(buildPage(p))

  return {
    container,
    scrollBy,
    wordEls: () => Array.from(container.querySelectorAll<HTMLElement>(`.${PDF_WORD_CLASS}`)),
    buildPage,
  }
}

const cursorIdx = (c: PdfTextCursor) => c.getVimCursorIndex()
const highlighted = (f: Fixture) =>
  f.wordEls().flatMap((el, i) => (el.classList.contains(PDF_WORD_SELECTED_CLASS) ? [i] : []))
const cursorEls = (f: Fixture) => f.wordEls().filter(el => el.classList.contains(PDF_WORD_CURSOR_CLASS))

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('PdfTextCursor', () => {
  let f: Fixture
  let cursor: PdfTextCursor
  let onChange: Mock<(cursor: PdfWordRef | null) => void>
  let onConfirm: Mock<(sel: PdfSelectionInfo) => void>
  let onClear: Mock<() => void>

  beforeEach(() => {
    f = makeFixture()
    onChange = vi.fn<(cursor: PdfWordRef | null) => void>()
    onConfirm = vi.fn<(sel: PdfSelectionInfo) => void>()
    onClear = vi.fn<() => void>()
    cursor = new PdfTextCursor(f.container, { onChange, onConfirm, onClear })
  })

  it('refresh() collects words in DOM order with text, page and flat index', () => {
    expect(cursor.words).toHaveLength(24)
    expect(cursor.words.map(w => w.text)).toEqual([...PAGE_TEXT[1], ...PAGE_TEXT[2]])
    expect(cursor.words.map(w => w.index)).toEqual(Array.from({ length: 24 }, (_, i) => i))
    expect(cursor.words.slice(0, 12).every(w => w.pageNum === 1)).toBe(true)
    expect(cursor.words.slice(12).every(w => w.pageNum === 2)).toBe(true)
    expect(cursor.words[13].el).toBe(f.wordEls()[13])
    expect(cursorIdx(cursor)).toBe(-1)
    expect(cursor.mode).toBe('normal')
  })

  it('selectWordByDelta(0) picks the first word whose top is inside the viewport', () => {
    cursor.selectWordByDelta(0)
    expect(cursorIdx(cursor)).toBe(0)
    expect(cursorEls(f)).toEqual([f.wordEls()[0]])

    // Scroll so page 1's first line (y=20..40) is above the viewport: line 2 (y=60) is first.
    f.container.scrollTop = 50
    cursor.selectWordByDelta(0)
    expect(cursorIdx(cursor)).toBe(4)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ index: 4, text: 'Jumps' }))
  })

  it('selectWordByDelta(0) falls back to the nearest word below when nothing is in view', () => {
    // A 60px viewport scrolled into the gap between page 1's last line (y=100) and page 2's first (y=220).
    const g = makeFixture({ viewportHeight: 60 })
    const c = new PdfTextCursor(g.container)
    g.container.scrollTop = 130 // viewport covers y 130..190 — no word there
    c.selectWordByDelta(0)
    expect(cursorIdx(c)).toBe(12) // 'late!' at y=220 is the nearest below
  })

  it('h/l move by delta and clamp at both ends, firing onChange each time', () => {
    cursor.selectWordByIndex(0)
    onChange.mockClear()
    cursor.selectWordByDelta(-1)
    expect(cursorIdx(cursor)).toBe(0)
    cursor.selectWordByDelta(3)
    expect(cursorIdx(cursor)).toBe(3)
    cursor.selectWordByDelta(999999)
    expect(cursorIdx(cursor)).toBe(23)
    cursor.selectWordByDelta(1)
    expect(cursorIdx(cursor)).toBe(23)
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ index: 23, text: 'here.' }))
    // Only one span ever carries the cursor class.
    expect(cursorEls(f)).toEqual([f.wordEls()[23]])
  })

  it('j/k move to the nearest word on the next/previous line, preferring the same column', () => {
    cursor.selectWordByIndex(1) // 'quick', line 0 col 1
    cursor.selectWordVertical(1)
    expect(cursorIdx(cursor)).toBe(5) // 'over', line 1 col 1
    cursor.selectWordVertical(1)
    expect(cursorIdx(cursor)).toBe(9) // 'Dr.', line 2 col 1
    cursor.selectWordVertical(-1)
    expect(cursorIdx(cursor)).toBe(5)
    cursor.selectWordVertical(-1)
    expect(cursorIdx(cursor)).toBe(1)
  })

  it('j crosses from the last line of page 1 to the first line of page 2, k crosses back', () => {
    cursor.selectWordByIndex(10) // 'Smith', page 1 line 2 col 2
    cursor.selectWordVertical(1)
    expect(cursorIdx(cursor)).toBe(14) // 'there,"', page 2 line 0 col 2
    cursor.selectWordVertical(-1)
    expect(cursorIdx(cursor)).toBe(10)
  })

  it('j/k with no word in that direction scrolls the container by a quarter viewport and keeps the cursor', () => {
    cursor.selectWordByIndex(22) // 'end', last line of page 2
    onChange.mockClear()
    cursor.selectWordVertical(1)
    expect(cursorIdx(cursor)).toBe(22)
    expect(f.scrollBy).toHaveBeenCalledWith({ top: 150 }) // round(600 * 0.25)
    expect(onChange).not.toHaveBeenCalled()

    cursor.selectWordByIndex(2) // first line of page 1
    f.scrollBy.mockClear()
    cursor.selectWordVertical(-1)
    expect(cursorIdx(cursor)).toBe(2)
    expect(f.scrollBy).toHaveBeenCalledWith({ top: -150 })
  })

  it('selectWordVertical with no cursor behaves like selectWordByDelta(0)', () => {
    cursor.selectWordVertical(1)
    expect(cursorIdx(cursor)).toBe(0)
    expect(f.scrollBy).not.toHaveBeenCalled()
  })

  it('selectSentenceByDelta highlights the whole sentence and puts the cursor on its first word', () => {
    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(0) // sentence containing first visible word (0) → [0,4)
    expect(highlighted(f)).toEqual([0, 1, 2, 3])
    expect(cursorIdx(cursor)).toBe(0)
    expect(cursor.getSelectedText()).toBe('The quick brown fox.')

    cursor.selectSentenceByDelta(1) // [4,9)
    expect(highlighted(f)).toEqual([4, 5, 6, 7, 8])
    expect(cursorIdx(cursor)).toBe(4)

    cursor.selectSentenceByDelta(1) // [9,13) crosses pages: Dr. Smith arrived late!
    expect(highlighted(f)).toEqual([9, 10, 11, 12])
    expect(cursor.getSelectedText()).toBe('Dr. Smith arrived late!')

    cursor.selectSentenceByDelta(-5) // clamps to sentence 0
    expect(highlighted(f)).toEqual([0, 1, 2, 3])
    cursor.selectSentenceByDelta(99) // clamps to the last sentence [21,24)
    expect(highlighted(f)).toEqual([21, 22, 23])
    expect(cursorIdx(cursor)).toBe(21)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ index: 21, text: 'Fin' }))
  })

  it('selectSentenceByDelta(0) uses the first visible word after scrolling', () => {
    f.container.scrollTop = 230 // page 2 line 1 (y=260) is the first line in view → word 16 'said.' → sentence [13,17)
    cursor.selectSentenceByDelta(0)
    expect(highlighted(f)).toEqual([13, 14, 15, 16])
    expect(cursorIdx(cursor)).toBe(13)
  })

  it('selectSentenceVertical picks the sentence whose first word is on the nearest line in that direction', () => {
    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(0) // [0,4), first word on line 0
    cursor.selectSentenceVertical(1) // nearest line below with a sentence start: line 1 → [4,9)
    expect(highlighted(f)).toEqual([4, 5, 6, 7, 8])
    cursor.selectSentenceVertical(1) // line 2 → 'Dr.' starts [9,13)
    expect(highlighted(f)).toEqual([9, 10, 11, 12])
    cursor.selectSentenceVertical(1) // page 2 line 0 → '"Hello' starts [13,17)
    expect(highlighted(f)).toEqual([13, 14, 15, 16])
    cursor.selectSentenceVertical(-1) // back up to 'Dr.'
    expect(highlighted(f)).toEqual([9, 10, 11, 12])
    expect(cursorIdx(cursor)).toBe(9)
  })

  it('visual mode anchors at the cursor and l/j extend an inclusive range from it', () => {
    cursor.selectWordByIndex(5) // 'over'
    cursor.setMode('visual')
    cursor.selectWordByDelta(1)
    expect(highlighted(f)).toEqual([5, 6])
    cursor.selectWordByDelta(1)
    expect(highlighted(f)).toEqual([5, 6, 7])
    cursor.selectWordVertical(1) // 'the' (7, line 1 col 3) → line 2 col 3 = 11 'arrived'
    expect(cursorIdx(cursor)).toBe(11)
    expect(highlighted(f)).toEqual([5, 6, 7, 8, 9, 10, 11])
    // Moving back before the anchor flips the range.
    cursor.selectWordByDelta(-8)
    expect(cursorIdx(cursor)).toBe(3)
    expect(highlighted(f)).toEqual([3, 4, 5])
    expect(cursor.getSelectedText()).toBe('fox. Jumps over')
  })

  it('leaving visual mode drops the anchor so normal-mode motions no longer extend', () => {
    cursor.selectWordByIndex(5)
    cursor.setMode('visual')
    cursor.selectWordByDelta(2)
    expect(highlighted(f)).toEqual([5, 6, 7])
    cursor.setMode('normal')
    cursor.selectWordByDelta(1)
    expect(highlighted(f)).toEqual([])
    expect(cursorIdx(cursor)).toBe(8)
  })

  it('selectCurrentLine highlights every word on the cursor line and moves the cursor to its first word', () => {
    cursor.selectWordByIndex(14) // 'there,"', page 2 line 0
    cursor.setMode('visual')
    cursor.selectCurrentLine()
    expect(highlighted(f)).toEqual([12, 13, 14, 15])
    expect(cursorIdx(cursor)).toBe(12)
    expect(cursor.getSelectedText()).toBe('late! "Hello there," she')
    // The anchor was re-based at the line start, so extending grows from there.
    cursor.selectWordByDelta(1)
    expect(highlighted(f)).toEqual([12, 13])
  })

  it('selectToEnd / selectToStart union with the existing highlight and move the cursor to the edge', () => {
    cursor.selectWordByIndex(14)
    cursor.setMode('visual')
    cursor.selectCurrentLine() // [12..15]
    cursor.selectToEnd()
    expect(highlighted(f)).toEqual(Array.from({ length: 12 }, (_, i) => 12 + i))
    expect(cursorIdx(cursor)).toBe(23)

    const g = makeFixture()
    const c = new PdfTextCursor(g.container)
    c.selectWordByIndex(20)
    c.setMode('visual')
    c.selectWordByDelta(2) // [20..22]
    c.selectToStart()
    expect(highlighted(g)).toEqual(Array.from({ length: 23 }, (_, i) => i))
    expect(cursorIdx(c)).toBe(0)
  })

  it('getSelectedText: cursor word in normal mode, sentence in sentence mode, range in visual mode, "" with nothing', () => {
    expect(cursor.getSelectedText()).toBe('')
    cursor.selectWordByIndex(6)
    expect(cursor.getSelectedText()).toBe('the')
    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(1) // from the cursor's sentence [4,9) to [9,13)
    expect(cursor.getSelectedText()).toBe('Dr. Smith arrived late!')
    cursor.setMode('normal') // sentence → normal clears the sentence highlight
    expect(highlighted(f)).toEqual([])
    expect(cursor.getSelectedText()).toBe('Dr.')
    cursor.setMode('visual')
    cursor.selectWordByDelta(2)
    expect(cursor.getSelectedText()).toBe('Dr. Smith arrived')
  })

  it('confirmSelection builds the PdfSelectionInfo payload from the sentence containing the cursor', () => {
    cursor.confirmSelection()
    expect(onConfirm).not.toHaveBeenCalled() // no cursor yet

    cursor.selectWordByIndex(11) // 'arrived' in "Dr. Smith arrived late!"
    cursor.confirmSelection()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const info = onConfirm.mock.calls[0][0] as PdfSelectionInfo
    expect(info).toEqual({
      text: 'arrived',
      sentenceText: 'Dr. Smith arrived late!',
      sentenceWords: ['Dr.', 'Smith', 'arrived', 'late!'],
      wordIndexInSentence: 2,
      anchorEl: f.wordEls()[11],
      pageNum: 1,
      mode: 'normal',
    })

    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(1) // [13,17)
    cursor.confirmSelection()
    const sentInfo = onConfirm.mock.calls[1][0] as PdfSelectionInfo
    expect(sentInfo.text).toBe('"Hello there," she said.')
    expect(sentInfo.wordIndexInSentence).toBe(0)
    expect(sentInfo.pageNum).toBe(2)
    expect(sentInfo.mode).toBe('sentence')
  })

  it('a click on a word moves the cursor there and fires onConfirm', () => {
    const target = f.wordEls()[17] // 'It'
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cursorIdx(cursor)).toBe(17)
    expect(cursorEls(f)).toEqual([target])
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ index: 17, text: 'It' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const info = onConfirm.mock.calls[0][0] as PdfSelectionInfo
    expect(info.anchorEl).toBe(target)
    expect(info.sentenceText).toBe("It was 3 o'clock.")

    // Clicks outside any word are ignored.
    f.container.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cursorIdx(cursor)).toBe(17)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a click in visual mode extends the range from the anchor', () => {
    cursor.selectWordByIndex(2)
    cursor.setMode('visual')
    f.wordEls()[6].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(highlighted(f)).toEqual([2, 3, 4, 5, 6])
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect((onConfirm.mock.calls[0][0] as PdfSelectionInfo).text).toBe('brown fox. Jumps over the')
  })

  it('a click is ignored while the user has a native drag selection', () => {
    cursor.selectWordByIndex(3)
    onChange.mockClear()
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'quick brown',
    } as unknown as Selection)
    f.wordEls()[9].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(cursorIdx(cursor)).toBe(3)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('refresh() keeps the cursor on the same element when a page is inserted before it', () => {
    const g = makeFixture({ pages: [2] })
    const changes = vi.fn()
    const c = new PdfTextCursor(g.container, { onChange: changes })
    c.selectWordByIndex(1) // '"Hello' — flat index 1 while only page 2 exists
    const anchorEl = c.words[1].el
    c.setMode('visual')
    c.selectWordByDelta(2) // cursor on 'she' (3), highlight [1..3]
    const cursorEl = c.words[3].el
    changes.mockClear()

    g.container.insertBefore(g.buildPage(1), g.container.firstChild)
    c.refresh()

    expect(c.words).toHaveLength(24)
    expect(c.getVimCursorIndex()).toBe(15) // 3 + the 12 words of page 1
    expect(c.words[15].el).toBe(cursorEl) // same element, new index
    expect(c.words[13].el).toBe(anchorEl)
    expect(cursorEls(g)).toEqual([g.wordEls()[15]])
    expect(highlighted(g)).toEqual([13, 14, 15]) // highlight elements re-indexed, not lost
    expect(c.getSelectedText()).toBe('"Hello there," she')
    expect(changes).toHaveBeenCalledTimes(1) // index changed → one onChange
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ index: 15, text: 'she' }))
    // Visual anchor survived too: extending still grows from '"Hello'.
    c.selectWordByDelta(1)
    expect(highlighted(g)).toEqual([13, 14, 15, 16])
  })

  it('refresh() clamps onto the new list when the cursor element was removed', () => {
    cursor.selectWordByIndex(20)
    f.container.lastElementChild!.remove() // drop page 2
    cursor.refresh()
    expect(cursor.words).toHaveLength(12)
    expect(cursorIdx(cursor)).toBe(11)
    expect(cursorEls(f)).toEqual([f.wordEls()[11]])
  })

  it('clearVimSelection keeps the cursor (and its class) but drops highlights and fires onClear', () => {
    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(0)
    cursor.clearVimSelection()
    expect(highlighted(f)).toEqual([])
    expect(cursorIdx(cursor)).toBe(0)
    expect(cursorEls(f)).toEqual([f.wordEls()[0]])
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(cursor.getSelectedText()).toBe('The')
  })

  it('dispose() removes every class and stops listening for clicks', () => {
    cursor.setMode('visual')
    cursor.selectWordByDelta(0)
    cursor.selectWordByDelta(3)
    expect(highlighted(f)).toEqual([0, 1, 2, 3])
    cursor.dispose()
    expect(highlighted(f)).toEqual([])
    expect(cursorEls(f)).toEqual([])
    onConfirm.mockClear()
    f.wordEls()[5].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(cursor.getVimCursorIndex()).toBe(-1)
  })

  it('scrolls the container by exactly the overshoot past the 48px margin, never beyond', () => {
    const g = makeFixture({ viewportHeight: 200 })
    const c = new PdfTextCursor(g.container)
    c.selectWordByIndex(0) // centre: word at y=20..40 → wants scrollTop 30-100 = -70 → clamped to 0
    expect(g.container.scrollTop).toBe(0)
    c.selectWordByDelta(12) // 'late!' at y=220..240; bottom 240 > 200-48 → scroll by 88
    expect(g.container.scrollTop).toBe(88)
    expect(g.wordEls()[12].getBoundingClientRect().bottom).toBe(152)

    g.container.scrollTop = 100
    c.selectWordByDelta(-7) // index 5 at y=60 → top -40 < 48 → scroll up by 88
    expect(g.container.scrollTop).toBe(12)
    expect(g.wordEls()[5].getBoundingClientRect().top).toBe(48)

    // Already within the margins: untouched.
    c.selectWordByDelta(1)
    expect(g.container.scrollTop).toBe(12)
  })

  it('selectWordByIndex clamps, clears highlights and centres the word', () => {
    cursor.setMode('sentence')
    cursor.selectSentenceByDelta(0)
    cursor.selectWordByIndex(999)
    expect(cursorIdx(cursor)).toBe(23)
    expect(highlighted(f)).toEqual([])
    // word 23 at y=300..320 → centre 310; viewport centre 300 → scrollTop 10
    expect(f.container.scrollTop).toBe(10)
    cursor.selectWordByIndex(-5)
    expect(cursorIdx(cursor)).toBe(0)
  })

  it('reads the page number from the wrapper when a word span lacks its own attribute', () => {
    const g = makeFixture({ pages: [2] })
    for (const el of g.wordEls()) el.removeAttribute(PDF_WORD_PAGE_ATTR)
    const c = new PdfTextCursor(g.container)
    expect(c.words.every(w => w.pageNum === 2)).toBe(true)
  })

  it('does nothing on an empty container', () => {
    const empty = document.createElement('div')
    document.body.appendChild(empty)
    const c = new PdfTextCursor(empty, { onChange, onConfirm })
    c.selectWordByDelta(0)
    c.selectSentenceByDelta(1)
    c.selectWordVertical(1)
    c.selectCurrentLine()
    c.selectToEnd()
    c.confirmSelection()
    c.setMode('visual')
    expect(c.getVimCursorIndex()).toBe(-1)
    expect(c.getSelectedText()).toBe('')
    expect(onChange).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
