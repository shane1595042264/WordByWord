import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { NibTextViewer, type NibTextViewerHandle } from '../nib-text-viewer'
import { NibMarkdownParser } from '@/lib/nib/markdown-parser'
import { NibDocument } from '@/lib/nib/models'
import { resolveTextViewPosition } from '@/lib/reader/text-view-position'

// jsdom has no layout, so lay the words out by hand: one word per 20px row
// inside a 200px-tall scroll container sitting at the top of the window.
const ROW = 20
const VIEWPORT = 200
const WORDS = 100

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

describe('NibTextViewer viewport position (KAN-372)', () => {
  let container: HTMLDivElement
  let restore: () => void

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: VIEWPORT })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: WORDS * ROW })
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === container) return rect(0, VIEWPORT)
      const idx = (this as HTMLElement).dataset?.wordIndex
      if (idx !== undefined) return rect(Number(idx) * ROW - container.scrollTop, ROW)
      return rect(0, 0)
    }
    Element.prototype.scrollIntoView = vi.fn()
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    restore = () => { Element.prototype.getBoundingClientRect = original }
  })

  afterEach(() => {
    restore()
    vi.unstubAllGlobals()
    container.remove()
  })

  function renderViewer() {
    const text = Array.from({ length: WORDS }, (_, i) => `w${i}`).join(' ') + '.'
    const doc = new NibDocument(new NibMarkdownParser().parse(text, 'T', 'A'))
    const ref = createRef<NibTextViewerHandle>()
    const scrollRef = { current: container }
    render(<NibTextViewer ref={ref} nibDocument={doc} sectionTitle="S" scrollContainerRef={scrollRef} />, { container })
    return ref
  }

  /** What the reader page saves for Continue Reading, from the live handle. */
  function savedPosition(ref: React.RefObject<NibTextViewerHandle | null>, cursorProgress: number) {
    const v = ref.current!
    const cursor = v.getVimCursorIndex()
    const cursorInView = v.isWordInView(cursor)
    return resolveTextViewPosition({
      cursorProgress,
      cursorWordIndex: cursor,
      cursorInView,
      viewportWordIndex: cursorInView ? null : v.getViewportWordIndex(),
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    })
  }

  it('a mouse scroll that leaves the cursor behind saves the viewport position, not word 0', () => {
    const ref = renderViewer()
    expect(ref.current!.getVimCursorIndex()).toBe(0)

    // Scroll 70% down (maxScroll = 2000 - 200 = 1800) without touching the cursor.
    container.scrollTop = 1260
    // Rows 63..72 are on screen; the middle (y=100) falls in row 68.
    expect(ref.current!.isWordInView(0)).toBe(false)
    expect(ref.current!.getViewportWordIndex()).toBe(68)
    expect(savedPosition(ref, 0)).toEqual({ progress: 70, wordIndex: 68 })
  })

  it('a vim move keeps the exact cursor word as the saved position', () => {
    const ref = renderViewer()
    act(() => { ref.current!.selectWordByDelta(3) })
    expect(ref.current!.getVimCursorIndex()).toBe(3)
    expect(ref.current!.isWordInView(3)).toBe(true)
    expect(savedPosition(ref, 4)).toEqual({ progress: 4, wordIndex: 3 })
  })

  it('a cursor move after a scroll wins again once the cursor is back on screen', () => {
    const ref = renderViewer()
    container.scrollTop = 1260
    expect(savedPosition(ref, 0).wordIndex).toBe(68)
    // Jump the cursor to a word in view (as a click or a vim motion that
    // scrolls it into view would): the cursor is newest, so it wins.
    act(() => { ref.current!.selectWordByIndex(65) })
    expect(savedPosition(ref, 50)).toEqual({ progress: 50, wordIndex: 65 })
  })

  it('returns null when no word is on screen', () => {
    const ref = renderViewer()
    container.scrollTop = WORDS * ROW + 500
    expect(ref.current!.getViewportWordIndex()).toBeNull()
  })
})
