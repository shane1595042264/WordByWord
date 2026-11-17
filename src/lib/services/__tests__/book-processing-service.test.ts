import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BookProcessingService } from '../book-processing-service'
import { db } from '@/lib/db/database'

const pdf = vi.hoisted(() => ({ totalPages: 20, outline: true, pageText: 'Some text' }))

vi.mock('../pdf-service', () => {
  const PDFService = vi.fn().mockImplementation(function () {
    return {
      extractMetadata: vi.fn(async () => ({ title: 'Test', author: 'Auth', totalPages: pdf.totalPages })),
      extractOutline: vi.fn(async () => pdf.outline
        ? [
            { title: 'Chapter 1', pageNumber: 1, children: [] },
            { title: 'Chapter 2', pageNumber: 11, children: [] },
          ]
        : null),
      renderPageToImage: vi.fn().mockResolvedValue('data:image/png;base64,abc'),
      extractPageText: vi.fn(async () => pdf.pageText),
    }
  })
  return { PDFService }
})

vi.mock('../nib-service', () => ({
  NibService: vi.fn().mockImplementation(function () {
    return { getCleanText: vi.fn().mockResolvedValue('') }
  }),
}))

vi.mock('../sync-service', () => ({
  syncService: { uploadBook: vi.fn().mockResolvedValue(null), sync: vi.fn() },
}))

// Since 2026-11-17 section splitting and OCR run on nibble-api with the
// reader's own AI key (BYOK); the browser holds no provider key.
type Call = { url: string; body: any }
let calls: Call[]
let respond: (url: string, body: any) => Response

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  pdf.totalPages = 20
  pdf.outline = true
  pdf.pageText = 'Some text'
  calls = []
  respond = (_url, body) => json({
    sections: [
      { title: `Section from ${body.startPage}`, startPage: body.startPage, endPage: body.startPage + 4, summary: 's' },
      { title: `Section to ${body.startPage + body.pageImages.length - 1}`, startPage: body.startPage + 5, endPage: body.startPage + body.pageImages.length - 1, summary: 's' },
    ],
  })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/token') return json({ token: 'fake.jwt' })
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, body })
    return respond(url, body)
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('BookProcessingService', () => {
  it('should import a book with native TOC structure', async () => {
    const service = new BookProcessingService()
    const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: true })

    const book = await db.books.get(bookId)
    expect(book?.title).toBe('Test')

    const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('order')
    expect(chapters).toHaveLength(2)
    expect(chapters[0].title).toBe('Chapter 1')
  })

  it('splits a chapter into sections through nibble-api, without any provider key', async () => {
    const service = new BookProcessingService()
    const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: true })
    const [chapter] = await db.chapters.where('bookId').equals(bookId).sortBy('order')

    await service.processChapterWithAI(bookId, chapter.id)

    const split = calls.filter((c) => c.url.endsWith('/ai/split-sections'))
    expect(split).toHaveLength(1)
    expect(split[0].body.pageImages[0]).toBe('abc') // data-URL prefix stripped
    expect(split[0].body).toMatchObject({ startPage: 1, bookTitle: 'Test' })
    const sections = await db.sections.where('chapterId').equals(chapter.id).toArray()
    expect(sections.map((s) => s.title).filter((t) => t.startsWith('Section '))).toEqual(['Section from 1', 'Section to 10'])
  })

  it('sends a long chapter in batches of ten pages, each told where the last one ended', async () => {
    pdf.totalPages = 25
    pdf.outline = false
    const service = new BookProcessingService()
    const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: false })
    const chapterId = 'long-chapter'
    await db.chapters.add({ id: chapterId, bookId, title: 'Long', order: 99, startPage: 1, endPage: 25, updatedAt: Date.now() })

    await service.processChapterWithAI(bookId, chapterId)

    const split = calls.filter((c) => c.url.endsWith('/ai/split-sections'))
    expect(split.map((c) => [c.body.startPage, c.body.pageImages.length])).toEqual([[1, 10], [11, 10], [21, 5]])
    expect(split[1].body.previousSectionTitle).toBe('Section to 10')
    expect(split[2].body.previousSectionTitle).toBe('Section to 20')
  })

  it('a reader without a key gets the server copy naming Settings > AI', async () => {
    const service = new BookProcessingService()
    const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: true })
    const [chapter] = await db.chapters.where('bookId').equals(bookId).sortBy('order')
    respond = () => json({ error: { code: 'AI_KEY_REQUIRED', message: 'Add your own AI key in Settings > AI to use this.', status: 409 } }, 409)

    await expect(service.processChapterWithAI(bookId, chapter.id)).rejects.toThrow('Add your own AI key in Settings > AI to use this.')
  })

  it('scanned pages without a key import blank and say why, instead of failing the import', async () => {
    pdf.outline = false
    pdf.totalPages = 3
    pdf.pageText = ''
    respond = () => json({ error: { code: 'AI_KEY_REQUIRED', message: 'Add your own AI key in Settings > AI to use this.', status: 409 } }, 409)
    const progress: string[] = []
    const service = new BookProcessingService()

    const bookId = await service.importBook(new Blob(['test pdf']), { useNativeTOC: false, onProgress: (m) => progress.push(m) })

    expect(calls.filter((c) => c.url.endsWith('/ai/ocr'))).toHaveLength(1)
    expect(progress.some((m) => m.startsWith('OCR skipped (Add your own AI key in Settings > AI'))).toBe(true)
    expect(await db.sections.where('bookId').equals(bookId).count()).toBe(3)
  })
})
