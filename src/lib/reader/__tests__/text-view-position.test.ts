import { describe, it, expect } from 'vitest'
import { resolveTextViewPosition, type TextViewSnapshot } from '../text-view-position'

const base: TextViewSnapshot = {
  cursorProgress: 12,
  cursorWordIndex: 40,
  cursorInView: true,
  viewportWordIndex: 900,
  scrollTop: 7000,
  scrollHeight: 11000,
  clientHeight: 1000,
}

describe('resolveTextViewPosition (KAN-372)', () => {
  it('keeps the exact cursor word and cursor-line progress while the cursor is on screen', () => {
    expect(resolveTextViewPosition(base)).toEqual({ progress: 12, wordIndex: 40 })
  })

  it('switches to the viewport once a scroll carries the cursor off screen', () => {
    expect(resolveTextViewPosition({ ...base, cursorInView: false })).toEqual({ progress: 70, wordIndex: 900 })
  })

  it('a scroll-only session with the cursor left at word 0 no longer saves wi=0 / 0%', () => {
    const pos = resolveTextViewPosition({ ...base, cursorProgress: 0, cursorWordIndex: 0, cursorInView: false })
    expect(pos.wordIndex).toBe(900)
    expect(pos.progress).toBe(70)
  })

  it('saves no word when none is on screen, so restore falls back to the scroll percent', () => {
    expect(resolveTextViewPosition({ ...base, cursorInView: false, viewportWordIndex: null }))
      .toEqual({ progress: 70, wordIndex: null })
  })

  it('reports 100 for content that fits without scrolling, and clamps out-of-range scrollTop', () => {
    expect(resolveTextViewPosition({ ...base, cursorInView: false, scrollHeight: 800 }).progress).toBe(100)
    expect(resolveTextViewPosition({ ...base, cursorInView: false, scrollTop: 99999 }).progress).toBe(100)
    expect(resolveTextViewPosition({ ...base, cursorInView: false, scrollTop: -50 }).progress).toBe(0)
  })
})
