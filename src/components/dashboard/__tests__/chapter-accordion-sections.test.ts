import { describe, it, expect } from 'vitest'
import { buildSectionsFromDividers } from '../chapter-accordion'
import type { ChapterWithSections } from '@/hooks/use-book-detail'
import type { Section } from '@/lib/db/models'

type ChapterArg = Pick<ChapterWithSections, 'startPage' | 'endPage' | 'sections'>

function section(title: string, startPage: number, endPage: number, order: number): Section {
  return {
    id: `sec-${order}`,
    bookId: 'book-1',
    chapterId: 'ch-1',
    title,
    order,
    startPage,
    endPage,
    extractedText: null,
    isRead: false,
    readAt: null,
    lastPageViewed: null,
    scrollProgress: null,
    updatedAt: 0,
  }
}

// A chapter spanning pages 10-40 whose first section is a real, AI-derived title.
function chapter(sections: Section[]): ChapterArg {
  return { startPage: 10, endPage: 40, sections }
}

const namedFirst = [
  section('Technical requirements', 10, 19, 1),
  section('Setting up Redis Stack', 20, 40, 2),
]

describe('buildSectionsFromDividers', () => {
  it('preserves the first section title on a no-op save', () => {
    // Exactly what the dialog hands back when the user opens it and saves nothing:
    // existingDividers excludes the section starting at the chapter start page.
    const sections = buildSectionsFromDividers(chapter(namedFirst), [
      { page: 20, title: 'Setting up Redis Stack' },
    ])

    expect(sections).toEqual([
      { title: 'Technical requirements', startPage: 10, endPage: 19 },
      { title: 'Setting up Redis Stack', startPage: 20, endPage: 40 },
    ])
  })

  it('keeps the first title when a new divider is added mid-chapter', () => {
    const sections = buildSectionsFromDividers(chapter(namedFirst), [
      { page: 20, title: 'Setting up Redis Stack' },
      { page: 31, title: 'Querying JSON' },
    ])

    expect(sections).toEqual([
      { title: 'Technical requirements', startPage: 10, endPage: 19 },
      { title: 'Setting up Redis Stack', startPage: 20, endPage: 30 },
      { title: 'Querying JSON', startPage: 31, endPage: 40 },
    ])
  })

  it('collapses to the original title when every divider is removed', () => {
    const sections = buildSectionsFromDividers(chapter(namedFirst), [])

    expect(sections).toEqual([
      { title: 'Technical requirements', startPage: 10, endPage: 40 },
    ])
  })

  it('does not duplicate a divider title when no section covers the chapter start', () => {
    // Every section starts after page 10, so every one of them is also a divider.
    // Segment 0 is a gap with no existing section -- it must get the placeholder,
    // not a copy of the title that already names segment 1.
    const allAfterStart = [
      section('Setting up Redis Stack', 14, 30, 1),
      section('Querying JSON', 31, 40, 2),
    ]
    const sections = buildSectionsFromDividers(chapter(allAfterStart), [
      { page: 14, title: 'Setting up Redis Stack' },
      { page: 31, title: 'Querying JSON' },
    ])

    expect(sections).toEqual([
      { title: 'Section 1', startPage: 10, endPage: 13 },
      { title: 'Setting up Redis Stack', startPage: 14, endPage: 30 },
      { title: 'Querying JSON', startPage: 31, endPage: 40 },
    ])
  })

  it('resolves the opening section by page coverage, not array position', () => {
    // getByChapter sorts by `order`, which can disagree with page order.
    const outOfOrder = [
      section('Setting up Redis Stack', 20, 40, 1),
      section('Technical requirements', 10, 19, 2),
    ]
    const sections = buildSectionsFromDividers(chapter(outOfOrder), [
      { page: 20, title: 'Setting up Redis Stack' },
    ])

    expect(sections[0].title).toBe('Technical requirements')
  })

  it('falls back to Section 1 when the chapter has no sections yet', () => {
    expect(buildSectionsFromDividers(chapter([]), [])).toEqual([
      { title: 'Section 1', startPage: 10, endPage: 40 },
    ])

    expect(buildSectionsFromDividers(chapter([]), [{ page: 20, title: 'Part two' }])).toEqual([
      { title: 'Section 1', startPage: 10, endPage: 19 },
      { title: 'Part two', startPage: 20, endPage: 40 },
    ])
  })

  it('falls back to Section 1 rather than writing an empty first title', () => {
    const blankFirst = [section('', 10, 19, 1), section('Setting up Redis Stack', 20, 40, 2)]
    const sections = buildSectionsFromDividers(chapter(blankFirst), [
      { page: 20, title: 'Setting up Redis Stack' },
    ])

    expect(sections[0].title).toBe('Section 1')
  })

  it('sorts unsorted dividers before assigning titles', () => {
    const sections = buildSectionsFromDividers(chapter(namedFirst), [
      { page: 31, title: 'Querying JSON' },
      { page: 20, title: 'Setting up Redis Stack' },
    ])

    expect(sections.map(s => s.title)).toEqual([
      'Technical requirements',
      'Setting up Redis Stack',
      'Querying JSON',
    ])
  })
})
