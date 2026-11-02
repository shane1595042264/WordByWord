import { describe, it, expect } from 'vitest'
import { toProgressPercentage } from '../progress-percentage'
import { computeSectionProgress } from '../repositories/section-repository'
import type { Section } from '../db/models'

const mk = (i: number, isRead: boolean, scrollProgress: number | null = null): Section => ({
  id: `s${i}`, chapterId: 'ch1', bookId: 'b1', title: `s${i}`, order: i, startPage: i, endPage: i + 1,
  extractedText: null, isRead, readAt: isRead ? Date.now() : null, lastPageViewed: null,
  scrollProgress, updatedAt: Date.now(),
})

describe('toProgressPercentage (KAN-381)', () => {
  it('caps at 99 while any section is unread', () => {
    expect(toProgressPercentage(99.5, 19, 20)).toBe(99)
    expect(toProgressPercentage(99.99, 656, 657)).toBe(99)
    expect(toProgressPercentage(100, 0, 1)).toBe(99)
  })

  it('reports 100 only when everything is read', () => {
    expect(toProgressPercentage(100, 20, 20)).toBe(100)
  })

  it('rounds normally below the cap and yields 0 for no sections', () => {
    expect(toProgressPercentage(42.5, 1, 4)).toBe(43)
    expect(toProgressPercentage(0, 0, 0)).toBe(0)
  })
})

describe('computeSectionProgress never shows 100% for an unfinished book (KAN-381)', () => {
  it('19 read + 1 at 90% -> 99', () => {
    const sections = [...Array.from({ length: 19 }, (_, i) => mk(i, true)), mk(19, false, 90)]
    expect(computeSectionProgress(sections)).toEqual({ read: 19, total: 20, percentage: 99 })
  })

  it('199 read + 1 unstarted -> 99', () => {
    const sections = [...Array.from({ length: 199 }, (_, i) => mk(i, true)), mk(199, false)]
    expect(computeSectionProgress(sections)).toEqual({ read: 199, total: 200, percentage: 99 })
  })

  it('all read -> 100, empty -> 0', () => {
    expect(computeSectionProgress(Array.from({ length: 200 }, (_, i) => mk(i, true))).percentage).toBe(100)
    expect(computeSectionProgress([])).toEqual({ read: 0, total: 0, percentage: 0 })
  })
})
