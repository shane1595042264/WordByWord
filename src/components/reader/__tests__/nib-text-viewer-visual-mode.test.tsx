import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRef } from 'react'
import { act, render } from '@testing-library/react'
import { NibTextViewer, type NibTextViewerHandle } from '../nib-text-viewer'
import { NibMarkdownParser } from '@/lib/nib/markdown-parser'
import { NibDocument } from '@/lib/nib/models'

// jsdom has no layout: lay the words out on a grid of 5 words per row,
// each word 100px wide, so j/k have a real "line below" to land on. ROW
// matches the viewer's 24px line grid so V finds exactly one row.
const ROW = 24
const PER_ROW = 5
const WORDS = 20

function rect(top: number, left: number, height: number, width: number): DOMRect {
  return { top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) } as DOMRect
}

describe('NibTextViewer visual mode extends the selection (KAN-408)', () => {
  let container: HTMLDivElement
  let restore: () => void

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 400 })
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this === container) return rect(0, 0, 400, 600)
      const idx = (this as HTMLElement).dataset?.wordIndex
      if (idx !== undefined) {
        const i = Number(idx)
        return rect(Math.floor(i / PER_ROW) * ROW, (i % PER_ROW) * 100, ROW, 100)
      }
      return rect(0, 0, 0, 0)
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

  const text = Array.from({ length: WORDS }, (_, i) => `w${i}`).join(' ') + '.'
  const doc = new NibDocument(new NibMarkdownParser().parse(text, 'T', 'A'))
  const words = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `w${from + i}${from + i === WORDS - 1 ? '.' : ''}`).join(' ')

  function renderViewer(vimMode: 'normal' | 'sentence' | 'visual' = 'normal') {
    const ref = createRef<NibTextViewerHandle>()
    const scrollRef = { current: container }
    const ui = (mode: typeof vimMode) => (
      <NibTextViewer ref={ref} nibDocument={doc} sectionTitle="S" scrollContainerRef={scrollRef} vimMode={mode} />
    )
    const { rerender } = render(ui(vimMode), { container })
    return { ref, setMode: (mode: typeof vimMode) => rerender(ui(mode)) }
  }

  const highlighted = () =>
    Array.from(container.querySelectorAll('[data-word-index].bg-amber-500\\/20')).map(el => Number((el as HTMLElement).dataset.wordIndex))

  it('v then 3l selects the anchor plus three words, and the range shrinks and flips around the anchor', () => {
    const { ref, setMode } = renderViewer()
    act(() => ref.current!.selectWordByIndex(2))
    setMode('visual')

    act(() => { for (let i = 0; i < 3; i++) ref.current!.selectWordByDelta(1) })
    expect(ref.current!.getSelectedText()).toBe(words(2, 5))
    expect(highlighted()).toEqual([2, 3, 4, 5])

    act(() => { ref.current!.selectWordByDelta(-1); ref.current!.selectWordByDelta(-1) })
    expect(ref.current!.getSelectedText()).toBe(words(2, 3))

    act(() => { for (let i = 0; i < 3; i++) ref.current!.selectWordByDelta(-1) })
    expect(ref.current!.getVimCursorIndex()).toBe(0)
    expect(ref.current!.getSelectedText()).toBe(words(0, 2))
  })

  it('j in visual mode extends the range across lines', () => {
    const { ref, setMode } = renderViewer()
    act(() => ref.current!.selectWordByIndex(1))
    setMode('visual')
    act(() => ref.current!.selectWordVertical(1))
    expect(ref.current!.getVimCursorIndex()).toBe(1 + PER_ROW)
    expect(ref.current!.getSelectedText()).toBe(words(1, 1 + PER_ROW))
    act(() => ref.current!.selectWordVertical(-1))
    expect(ref.current!.getSelectedText()).toBe(words(1, 1))
  })

  it('V re-anchors at the line start, so the next l extends from there', () => {
    const { ref, setMode } = renderViewer()
    act(() => ref.current!.selectWordByIndex(7))
    // V: the engine flips the mode and selects the line in the same keypress.
    act(() => ref.current!.selectCurrentLine())
    setMode('visual')
    expect(ref.current!.getSelectedText()).toBe(words(5, 9))
    act(() => ref.current!.selectWordByDelta(1))
    expect(ref.current!.getSelectedText()).toBe(words(5, 6))
  })

  it('Escape drops the anchor: back in normal mode a motion selects a single word', () => {
    const { ref, setMode } = renderViewer()
    setMode('visual')
    act(() => ref.current!.selectWordByDelta(1))
    expect(ref.current!.getSelectedText()).toBe(words(0, 1))

    setMode('normal')
    act(() => ref.current!.clearVimSelection())
    expect(highlighted()).toEqual([])
    act(() => ref.current!.selectWordByDelta(1))
    expect(highlighted()).toEqual([])
    expect(ref.current!.getSelectedText()).toBe('w2')
  })

  it('normal mode is unchanged: motions never highlight', () => {
    const { ref } = renderViewer()
    act(() => { for (let i = 0; i < 3; i++) ref.current!.selectWordByDelta(1) })
    expect(highlighted()).toEqual([])
    expect(ref.current!.getSelectedText()).toBe('w3')
    act(() => ref.current!.selectWordVertical(1))
    expect(highlighted()).toEqual([])
  })
})
