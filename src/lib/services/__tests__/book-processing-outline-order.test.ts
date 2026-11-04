import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookProcessingService } from '../book-processing-service'
import { db } from '@/lib/db/database'

// KAN-384: a chapter whose outline mixes plain sections with sub-headed ones
// used to have its plain leaves emitted first and its nested groups after, so
// reading order and every page range came out of document order.

const leaf = (title: string, pageNumber: number) => ({ title, pageNumber, children: [] })

const { outlineMock } = vi.hoisted(() => ({ outlineMock: vi.fn() }))

vi.mock('../pdf-service', () => {
  const PDFService = vi.fn().mockImplementation(function () {
    return {
      extractMetadata: vi.fn().mockResolvedValue({ title: 'Test', author: 'Auth', totalPages: 140 }),
      extractOutline: outlineMock,
      renderPageToImage: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
      extractPageText: vi.fn().mockResolvedValue('Some text'),
    }
  })
  return { PDFService }
})

vi.mock('../nib-service', () => {
  const NibService = vi.fn().mockImplementation(function () {
    return { getCleanText: vi.fn().mockResolvedValue('Some text') }
  })
  return { NibService }
})

vi.mock('../sync-service', () => ({
  syncService: { uploadBook: vi.fn().mockResolvedValue(null), sync: vi.fn() },
}))

async function importWith(outline: unknown[]) {
  outlineMock.mockResolvedValue(outline)
  const service = new BookProcessingService()
  const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: true })
  const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('order')
  const sections = await db.sections.where('bookId').equals(bookId).sortBy('order')
  return { chapters, sections }
}

describe('BookProcessingService outline walk order (KAN-384)', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('emits leaves in outline order with contiguous page ranges', async () => {
    const { chapters, sections } = await importWith([
      {
        title: 'Ch3', pageNumber: 100, children: [
          leaf('3.1', 100),
          { title: '3.2', pageNumber: 105, children: [leaf('3.2.1', 105), leaf('3.2.2', 110)] },
          leaf('3.3', 120),
          leaf('Exercises', 130),
        ],
      },
    ])

    expect(sections.map(s => [s.title, s.startPage, s.endPage])).toEqual([
      ['3.1', 100, 104],
      ['3.2.1', 105, 109],
      ['3.2.2', 110, 119],
      ['3.3', 120, 129],
      ['Exercises', 130, 140],
    ])
    expect(chapters.map(c => [c.title, c.startPage, c.endPage])).toEqual([
      ['Ch3', 100, 104],
      ['Ch3 > 3.2', 105, 119],
      ['Ch3', 120, 140],
    ])
    const chapterTitleOf = new Map(chapters.map(c => [c.id, c.title]))
    expect(sections.map(s => chapterTitleOf.get(s.chapterId))).toEqual([
      'Ch3', 'Ch3 > 3.2', 'Ch3 > 3.2', 'Ch3', 'Ch3',
    ])
  })

  it('still injects the Introduction ahead of a leading nested group', async () => {
    const { chapters, sections } = await importWith([
      {
        title: 'Part 1', pageNumber: 1, children: [
          { title: 'Ch1', pageNumber: 3, children: [leaf('1.1', 3), leaf('1.2', 5)] },
          leaf('Afterword', 8),
        ],
      },
    ])

    expect(chapters.map(c => c.title)).toEqual(['Part 1', 'Part 1 > Ch1', 'Part 1'])
    expect(sections.map(s => [s.title, s.startPage, s.endPage])).toEqual([
      ['Part 1 — Introduction', 1, 2],
      ['1.1', 3, 4],
      ['1.2', 5, 7],
      ['Afterword', 8, 140],
    ])
  })
})
