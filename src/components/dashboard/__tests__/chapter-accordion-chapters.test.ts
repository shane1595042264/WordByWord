import { describe, it, expect } from 'vitest'
import { buildChaptersFromDividers } from '../chapter-accordion'
import type { Divider } from '@/components/editor/page-strip-editor'

type Ch = { title: string; startPage: number }

// Exactly what the Reorganize Chapters dialog hands back on a no-op Accept:
// every chapter that starts after page 1 becomes a divider.
function unchangedDividers(chapters: Ch[]): Divider[] {
  return chapters.filter(ch => ch.startPage > 1).map(ch => ({ page: ch.startPage, title: ch.title }))
}

describe('buildChaptersFromDividers', () => {
  it('does not duplicate chapter 1 when it starts after page 1', () => {
    const chapters = [
      { title: 'Copyright', startPage: 6 },
      { title: 'Ch 2', startPage: 20 },
    ]
    const saved = buildChaptersFromDividers(chapters, 50, unchangedDividers(chapters))

    expect(saved).toEqual([
      { title: 'Front Matter', startPage: 1, endPage: 5 },
      { title: 'Copyright', startPage: 6, endPage: 19 },
      { title: 'Ch 2', startPage: 20, endPage: 50 },
    ])
    expect(saved.filter(c => c.title === 'Copyright')).toHaveLength(1)
  })

  it('saves a book whose chapter 1 starts on page 1 unchanged', () => {
    const chapters = [
      { title: 'Intro', startPage: 1 },
      { title: 'Ch 2', startPage: 10 },
      { title: 'Ch 3', startPage: 30 },
    ]
    expect(buildChaptersFromDividers(chapters, 40, unchangedDividers(chapters))).toEqual([
      { title: 'Intro', startPage: 1, endPage: 9 },
      { title: 'Ch 2', startPage: 10, endPage: 29 },
      { title: 'Ch 3', startPage: 30, endPage: 40 },
    ])
  })

  it('takes the opening title by page, not array order', () => {
    const chapters = [
      { title: 'Ch 2', startPage: 10 },
      { title: 'Intro', startPage: 1 },
    ]
    expect(buildChaptersFromDividers(chapters, 20, unchangedDividers(chapters))[0].title).toBe('Intro')
  })

  it('keeps a single page-1 chapter title when there are no dividers', () => {
    expect(buildChaptersFromDividers([{ title: 'Whole Book', startPage: 1 }], 12, [])).toEqual([
      { title: 'Whole Book', startPage: 1, endPage: 12 },
    ])
  })

  it('falls back to Chapter 1 for a book with no chapters and no dividers', () => {
    expect(buildChaptersFromDividers([], 12, [])).toEqual([
      { title: 'Chapter 1', startPage: 1, endPage: 12 },
    ])
  })
})
