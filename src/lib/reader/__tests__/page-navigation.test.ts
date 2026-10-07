import { describe, it, expect } from 'vitest'
import { clampPage, resolvePdfPageNav, type PageRangeSection } from '../page-navigation'

// A 1..1, B 1..2 (overlaps A on p.1), C 3..3, D 3..4 (overlaps C on p.3),
// E 7..8 (pages 5..6 are covered by no section).
const sections: readonly PageRangeSection[] = [
  { id: 'A', startPage: 1, endPage: 1 },
  { id: 'B', startPage: 1, endPage: 2 },
  { id: 'C', startPage: 3, endPage: 3 },
  { id: 'D', startPage: 3, endPage: 4 },
  { id: 'E', startPage: 7, endPage: 8 },
]

describe('resolvePdfPageNav — next (direction 1)', () => {
  it('A@1 next → section B page 2 (overlap: does not re-show page 1)', () => {
    expect(resolvePdfPageNav(sections, 'A', 1, 1)).toEqual({ kind: 'section', sectionId: 'B', page: 2 })
  })

  it('B@1 next → page 2 within the same section', () => {
    expect(resolvePdfPageNav(sections, 'B', 1, 1)).toEqual({ kind: 'page', page: 2 })
  })

  it('B@2 next → section C page 3', () => {
    expect(resolvePdfPageNav(sections, 'B', 2, 1)).toEqual({ kind: 'section', sectionId: 'C', page: 3 })
  })

  it('C@3 next → section D page 4 (D also covers 3; must land on 4)', () => {
    expect(resolvePdfPageNav(sections, 'C', 3, 1)).toEqual({ kind: 'section', sectionId: 'D', page: 4 })
  })

  it('D@4 next → section E page 7 (gap at 5..6: jumps to E.startPage)', () => {
    expect(resolvePdfPageNav(sections, 'D', 4, 1)).toEqual({ kind: 'section', sectionId: 'E', page: 7 })
  })

  it('E@8 next → null (nothing further)', () => {
    expect(resolvePdfPageNav(sections, 'E', 8, 1)).toBeNull()
  })

  it('multiple later sections contain the target → the first in order wins', () => {
    const overlapping: PageRangeSection[] = [
      { id: 'X', startPage: 1, endPage: 1 },
      { id: 'Y', startPage: 2, endPage: 3 },
      { id: 'Z', startPage: 2, endPage: 4 },
    ]
    expect(resolvePdfPageNav(overlapping, 'X', 1, 1)).toEqual({ kind: 'section', sectionId: 'Y', page: 2 })
  })
})

describe('resolvePdfPageNav — prev (direction -1)', () => {
  it('D@3 prev → section B page 2 (C is skipped because it starts after 2)', () => {
    expect(resolvePdfPageNav(sections, 'D', 3, -1)).toEqual({ kind: 'section', sectionId: 'B', page: 2 })
  })

  it('B@1 prev → null (target 0; A starts at 1 so it is skipped)', () => {
    expect(resolvePdfPageNav(sections, 'B', 1, -1)).toBeNull()
  })

  it('E@7 prev → section D page 4 (gap at 5..6: lands on D.endPage)', () => {
    expect(resolvePdfPageNav(sections, 'E', 7, -1)).toEqual({ kind: 'section', sectionId: 'D', page: 4 })
  })

  it('C@3 prev → section B page 2', () => {
    expect(resolvePdfPageNav(sections, 'C', 3, -1)).toEqual({ kind: 'section', sectionId: 'B', page: 2 })
  })

  it('E@8 prev → page 7 within the same section', () => {
    expect(resolvePdfPageNav(sections, 'E', 8, -1)).toEqual({ kind: 'page', page: 7 })
  })

  it('multiple earlier sections contain the target → the nearest in reverse order wins', () => {
    const overlapping: PageRangeSection[] = [
      { id: 'X', startPage: 1, endPage: 3 },
      { id: 'Y', startPage: 2, endPage: 3 },
      { id: 'Z', startPage: 4, endPage: 4 },
    ]
    expect(resolvePdfPageNav(overlapping, 'Z', 4, -1)).toEqual({ kind: 'section', sectionId: 'Y', page: 3 })
  })
})

describe('resolvePdfPageNav — defensive cases', () => {
  it('unknown current section id → null', () => {
    expect(resolvePdfPageNav(sections, 'nope', 1, 1)).toBeNull()
    expect(resolvePdfPageNav(sections, 'nope', 1, -1)).toBeNull()
  })

  it('stale currentPage beyond the range (B@9 next) clamps to B first → section C page 3', () => {
    expect(resolvePdfPageNav(sections, 'B', 9, 1)).toEqual({ kind: 'section', sectionId: 'C', page: 3 })
  })

  it('stale currentPage below the range (E@2 prev) clamps to E first → section D page 4', () => {
    expect(resolvePdfPageNav(sections, 'E', 2, -1)).toEqual({ kind: 'section', sectionId: 'D', page: 4 })
  })

  it('empty section list → null', () => {
    expect(resolvePdfPageNav([], 'A', 1, 1)).toBeNull()
  })
})

describe('clampPage', () => {
  const s: PageRangeSection = { id: 's', startPage: 3, endPage: 7 }

  it('returns the page unchanged when inside the range', () => {
    expect(clampPage(5, s)).toBe(5)
    expect(clampPage(3, s)).toBe(3)
    expect(clampPage(7, s)).toBe(7)
  })

  it('clamps below the range to startPage and above to endPage', () => {
    expect(clampPage(0, s)).toBe(3)
    expect(clampPage(99, s)).toBe(7)
  })
})
