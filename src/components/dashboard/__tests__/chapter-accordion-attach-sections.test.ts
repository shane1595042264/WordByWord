import { describe, it, expect } from 'vitest'
import { attachSectionsToChapters, buildChaptersFromDividers } from '../chapter-accordion'
import type { Divider } from '@/components/editor/page-strip-editor'

type Sec = { title: string; startPage: number; endPage: number }
type Ch = Sec & { sections: Sec[] }

// 3 chapters x 2 sections over 30 pages.
const book: Ch[] = [
  { title: 'Ch 1', startPage: 1, endPage: 10, sections: [
    { title: '1.1', startPage: 1, endPage: 5 },
    { title: '1.2', startPage: 6, endPage: 10 },
  ] },
  { title: 'Ch 2', startPage: 11, endPage: 20, sections: [
    { title: '2.1', startPage: 11, endPage: 15 },
    { title: '2.2', startPage: 16, endPage: 20 },
  ] },
  { title: 'Ch 3', startPage: 21, endPage: 30, sections: [
    { title: '3.1', startPage: 21, endPage: 25 },
    { title: '3.2', startPage: 26, endPage: 30 },
  ] },
]

const unchanged: Divider[] = [{ page: 11, title: 'Ch 2' }, { page: 21, title: 'Ch 3' }]

function save(dividers: Divider[], chapters: Ch[] = book, totalPages = 30) {
  return attachSectionsToChapters(buildChaptersFromDividers(chapters, totalPages, dividers), chapters)
}

describe('attachSectionsToChapters', () => {
  it('keeps every section on a no-change Accept', () => {
    expect(save(unchanged)).toEqual(book)
  })

  it('keeps untouched chapters intact when one divider moves', () => {
    const saved = save([{ page: 13, title: 'Ch 2' }, { page: 21, title: 'Ch 3' }])

    expect(saved[0]).toEqual({ title: 'Ch 1', startPage: 1, endPage: 12, sections: [
      { title: '1.1', startPage: 1, endPage: 5 },
      { title: '1.2', startPage: 6, endPage: 10 },
      { title: '2.1', startPage: 11, endPage: 12 },
    ] })
    expect(saved[1]).toEqual({ title: 'Ch 2', startPage: 13, endPage: 20, sections: [
      { title: '2.1', startPage: 13, endPage: 15 },
      { title: '2.2', startPage: 16, endPage: 20 },
    ] })
    expect(saved[2]).toEqual(book[2])
  })

  it('keeps both chapters sections when a divider is removed', () => {
    const saved = save([{ page: 21, title: 'Ch 3' }])
    expect(saved[0].sections?.map(s => s.title)).toEqual(['1.1', '1.2', '2.1', '2.2'])
    expect(saved[1]).toEqual(book[2])
  })

  it('names pages no old section covers after the chapter', () => {
    const sparse: Ch[] = [{ title: 'Ch 1', startPage: 1, endPage: 20, sections: [
      { title: 'Middle', startPage: 10, endPage: 15 },
    ] }]
    expect(save([], sparse)[0].sections).toEqual([
      { title: 'Ch 1', startPage: 1, endPage: 9 },
      { title: 'Middle', startPage: 10, endPage: 15 },
      { title: 'Ch 1', startPage: 16, endPage: 30 },
    ])
  })

  it('sends a chapter no old section touches bare', () => {
    const late: Ch[] = [{ title: 'Ch 1', startPage: 6, endPage: 30, sections: [
      { title: '1.1', startPage: 6, endPage: 30 },
    ] }]
    const saved = save([{ page: 6, title: 'Ch 1' }], late)
    expect(saved[0]).toEqual({ title: 'Front Matter', startPage: 1, endPage: 5 })
    expect(saved[1].sections).toEqual([{ title: '1.1', startPage: 6, endPage: 30 }])
  })

  it('sends an unchanged chapter its sections verbatim, even same-page and out-of-range ones', () => {
    const messy: Ch[] = [
      { title: 'Preface', startPage: 1, endPage: 1, sections: [
        { title: 'Intro', startPage: 1, endPage: 2 },
        { title: 'Later', startPage: 3, endPage: 3 },
      ] },
      { title: 'Ch 1', startPage: 2, endPage: 10, sections: [
        { title: 'A', startPage: 2, endPage: 2 },
        { title: 'B', startPage: 2, endPage: 2 },
        { title: 'C', startPage: 3, endPage: 10 },
      ] },
    ]
    expect(save([{ page: 2, title: 'Ch 1' }], messy, 10)).toEqual(messy)
  })

  it('keeps same-page sections when chapters merge', () => {
    const chs: Ch[] = [
      { title: 'Ch 1', startPage: 1, endPage: 4, sections: [
        { title: 'A', startPage: 1, endPage: 4 },
      ] },
      { title: 'Ch 2', startPage: 5, endPage: 10, sections: [
        { title: 'B', startPage: 5, endPage: 5 },
        { title: 'C', startPage: 5, endPage: 5 },
        { title: 'D', startPage: 6, endPage: 10 },
      ] },
    ]
    expect(save([], chs, 10)[0].sections).toEqual([
      { title: 'A', startPage: 1, endPage: 4 },
      { title: 'B', startPage: 5, endPage: 5 },
      { title: 'C', startPage: 5, endPage: 5 },
      { title: 'D', startPage: 6, endPage: 10 },
    ])
  })

  it('takes only the sections of chapters a changed chapter overlaps', () => {
    // Ch 1's AI section runs past its chapter into Ch 2's pages.
    const chs: Ch[] = [
      { title: 'Ch 1', startPage: 1, endPage: 5, sections: [{ title: 'Wide', startPage: 1, endPage: 20 }] },
      { title: 'Ch 2', startPage: 6, endPage: 10, sections: [{ title: 'X', startPage: 6, endPage: 10 }] },
      { title: 'Ch 3', startPage: 11, endPage: 20, sections: [{ title: 'Y', startPage: 11, endPage: 20 }] },
    ]
    const saved = save([{ page: 6, title: 'Ch 2' }, { page: 13, title: 'Ch 3' }], chs, 20)
    expect(saved[1].sections).toEqual([
      { title: 'X', startPage: 6, endPage: 10 },
      { title: 'Y', startPage: 11, endPage: 12 },
    ])
  })

  it('sends a chapter bare rather than exceed the 200-section cap', () => {
    const many: Ch[] = Array.from({ length: 201 }, (_, i) => ({
      title: `Ch ${i + 1}`, startPage: i + 1, endPage: i + 1,
      sections: [{ title: `S ${i + 1}`, startPage: i + 1, endPage: i + 1 }],
    }))
    expect(save([], many, 201)).toEqual([{ title: 'Ch 1', startPage: 1, endPage: 201 }])
  })
})
