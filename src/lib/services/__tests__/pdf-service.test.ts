import { describe, it, expect, vi } from 'vitest'
import { PDFService, capMetadataField, PDF_METADATA_FIELD_MAX } from '../pdf-service'

// Mock pdfjs-dist since it needs browser APIs
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}))

describe('PDFService', () => {
  const service = new PDFService()

  it('should extract metadata from a PDF', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const mockDoc = {
      numPages: 50,
      getMetadata: vi.fn().mockResolvedValue({
        info: { Title: 'Test Book', Author: 'Test Author' },
      }),
      getOutline: vi.fn().mockResolvedValue(null),
      destroy: vi.fn(),
    }
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(mockDoc) } as any)

    const result = await service.extractMetadata(new Blob(['test']))
    expect(result.title).toBe('Test Book')
    expect(result.author).toBe('Test Author')
    expect(result.totalPages).toBe(50)
  })

  it('should extract outline when available', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const mockDoc = {
      numPages: 100,
      getMetadata: vi.fn().mockResolvedValue({ info: {} }),
      getOutline: vi.fn().mockResolvedValue([
        { title: 'Chapter 1', dest: 'ch1', items: [] },
        { title: 'Chapter 2', dest: 'ch2', items: [] },
      ]),
      getPage: vi.fn().mockImplementation((pageNum: number) => ({
        getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      })),
      destroy: vi.fn(),
    }
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(mockDoc) } as any)

    const result = await service.extractOutline(new Blob(['test']))
    expect(result).toHaveLength(2)
    expect(result![0].title).toBe('Chapter 1')
  })

  it('should return null outline when none exists', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const mockDoc = {
      numPages: 10,
      getMetadata: vi.fn().mockResolvedValue({ info: {} }),
      getOutline: vi.fn().mockResolvedValue(null),
      destroy: vi.fn(),
    }
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(mockDoc) } as any)

    const result = await service.extractOutline(new Blob(['test']))
    expect(result).toBeNull()
  })
})

describe('capMetadataField (KAN-398)', () => {
  const names = Array.from({ length: 40 }, (_, i) => `Researcher Number${i} Lastname`)
  const longAuthor = names.join(', ')

  it('leaves short values unchanged', () => {
    expect(capMetadataField('Test Author', 'Unknown')).toBe('Test Author')
    expect(capMetadataField('a'.repeat(PDF_METADATA_FIELD_MAX), 'Unknown')).toHaveLength(PDF_METADATA_FIELD_MAX)
  })

  it('falls back on missing, non-string or whitespace-only values', () => {
    expect(capMetadataField(undefined, 'Unknown')).toBe('Unknown')
    expect(capMetadataField(42, 'Unknown')).toBe('Unknown')
    expect(capMetadataField('  \n ', 'Untitled')).toBe('Untitled')
  })

  it('collapses whitespace runs', () => {
    expect(capMetadataField('  A Title\r\n   Subtitle ', 'Untitled')).toBe('A Title Subtitle')
  })

  it('cuts a long author list at a name boundary', () => {
    expect(longAuthor.length).toBeGreaterThan(PDF_METADATA_FIELD_MAX)
    const result = capMetadataField(longAuthor, 'Unknown')
    expect(Array.from(result).length).toBeLessThanOrEqual(PDF_METADATA_FIELD_MAX)
    expect(result.endsWith('…')).toBe(true)
    const kept = result.slice(0, -1).split(', ')
    expect(kept).toEqual(names.slice(0, kept.length))
  })

  it('cuts a long title at a word boundary', () => {
    const title = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const result = capMetadataField(title, 'Untitled')
    expect(Array.from(result).length).toBeLessThanOrEqual(PDF_METADATA_FIELD_MAX)
    expect(title.startsWith(result.slice(0, -1) + ' ')).toBe(true)
  })

  it('hard-cuts a value with no boundary without splitting a surrogate pair', () => {
    const result = capMetadataField('\u{1F4DA}'.repeat(600), 'Untitled')
    expect(Array.from(result)).toHaveLength(PDF_METADATA_FIELD_MAX)
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })

  it('extractMetadata applies the cap', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const mockDoc = {
      numPages: 1,
      getMetadata: vi.fn().mockResolvedValue({ info: { Title: 't'.repeat(900), Author: longAuthor } }),
      destroy: vi.fn(),
    }
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(mockDoc) } as any)
    const result = await new PDFService().extractMetadata(new Blob(['test']))
    expect(Array.from(result.title).length).toBeLessThanOrEqual(PDF_METADATA_FIELD_MAX)
    expect(result.author).toBe(capMetadataField(longAuthor, 'Unknown'))
  })
})
