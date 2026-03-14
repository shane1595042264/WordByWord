import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PDFService } from '../pdf-service'
import { NibParser } from '@/lib/nib/parser'
import { NibTextParser } from '@/lib/nib/text-parser'

// Mock pdfjs-dist since it needs browser APIs
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  OPS: {
    save: 35, restore: 36, transform: 37, paintImageXObject: 85, paintImageXObjectRepeat: 86
  } // Mock OPS for image extraction tests
}))

// Mock NibParser and NibTextParser
vi.mock('@/lib/nib/parser', () => ({
  NibParser: vi.fn(() => ({
    parseDocument: vi.fn((pages, title, author) => ({
      version: 1, sourceTitle: title, sourceAuthor: author, pages,
      createdAt: Date.now(),
      type: 'rich-parsed' // Custom property for testing
    })),
  })),
}))

vi.mock('@/lib/nib/text-parser', () => ({
  NibTextParser: vi.fn(() => ({
    parseMultiPageText: vi.fn((text, title, author, startPage) => ({
      version: 1, sourceTitle: title, sourceAuthor: author, pages: [{
        pageNumber: startPage, paragraphs: [{ sentences: [{ words: [{ text: 'mock' }] }] }]
      }],
      createdAt: Date.now(),
      type: 'text-parsed', // Custom property for testing
      fullText: text // For verification
    })),
  })),
}))

describe('PDFService', () => {
  const service = new PDFService()

  // Mock PDF.js document and page objects for common use
  const mockPdfjsDoc = (numPages: number, metadataInfo: any, outline: any[] | null) => ({
    numPages,
    getMetadata: vi.fn().mockResolvedValue({ info: metadataInfo }),
    getOutline: vi.fn().mockResolvedValue(outline),
    getPage: vi.fn(async (pageNumber: number) => ({
      getViewport: vi.fn(() => ({ width: 595, height: 842 })),
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: `Text from page ${pageNumber}.`, transform: [1,0,0,1,0,800], width: 100, height: 10, fontName: 'f1' }],
      }),
      getOperatorList: vi.fn().mockResolvedValue({
        fnArray: [], argsArray: []
      }),
      commonObjs: { get: vi.fn(() => ({ name: 'mockFont' })) },
      render: vi.fn().mockResolvedValue({ promise: Promise.resolve() }),
    })),
    getDestination: vi.fn().mockResolvedValue([{}, { name: 'XYZ' }, 0, 0, 0]), // Mock for outline resolution
    getPageIndex: vi.fn().mockResolvedValue(0), // Mock for outline resolution
    destroy: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should extract metadata from a PDF', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(50, { Title: 'Test Book', Author: 'Test Author' }, null);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.extractMetadata(new Blob(['test']))
    expect(result.title).toBe('Test Book')
    expect(result.author).toBe('Test Author')
    expect(result.totalPages).toBe(50)
    expect(doc.getMetadata).toHaveBeenCalledOnce();
    expect(doc.destroy).toHaveBeenCalledOnce();
  })

  it('should extract outline when available', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(100, {}, [{ title: 'Chapter 1', dest: 'ch1', items: [] }]);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.extractOutline(new Blob(['test']))
    expect(result).toHaveLength(1)
    expect(result![0].title).toBe('Chapter 1')
    expect(doc.getOutline).toHaveBeenCalledOnce();
    expect(doc.destroy).toHaveBeenCalledOnce();
  })

  it('should return null outline when none exists', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(10, {}, null);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.extractOutline(new Blob(['test']))
    expect(result).toBeNull()
    expect(doc.getOutline).toHaveBeenCalledOnce();
    expect(doc.destroy).toHaveBeenCalledOnce();
  })

  it('should extract all text from a multi-page PDF', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(3, {}, null);
    doc.getPage.mockImplementation(async (pageNumber: number) => ({
      getViewport: vi.fn(() => ({ width: 595, height: 842 })),
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: `Page ${pageNumber} content.`, transform: [1,0,0,1,0,800], width: 100, height: 10, fontName: 'f1' }],
      }),
      getOperatorList: vi.fn().mockResolvedValue({ fnArray: [], argsArray: [] }),
      commonObjs: { get: vi.fn(() => ({ name: 'mockFont' })) },
      render: vi.fn().mockResolvedValue({ promise: Promise.resolve() }),
    }));
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.extractAllText(new Blob(['test']));
    expect(result).toBe('Page 1 content.\n\nPage 2 content.\n\nPage 3 content.');
    expect(doc.getPage).toHaveBeenCalledTimes(3);
    expect(doc.destroy).toHaveBeenCalledOnce();
  });

  it('should use NibParser for PDFs with an outline', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(2, { Title: 'Outline Book', Author: 'Outline Author' }, [{ title: 'Ch1', dest: 'ch1' }]);
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.processPdfDocument(new Blob(['test']), 'Outline Book', 'Outline Author');

    expect(NibParser).toHaveBeenCalledOnce();
    expect(NibTextParser).not.toHaveBeenCalled();
    expect(result.type).toBe('rich-parsed');
    expect(result.sourceTitle).toBe('Outline Book');
    expect(doc.getOutline).toHaveBeenCalledOnce();
    expect(doc.getPage).toHaveBeenCalledTimes(2); // For extractRichPageRange
    expect(doc.destroy).toHaveBeenCalledTimes(3); // metadata, outline, richPageRange
  });

  it('should use NibTextParser for PDFs without an outline', async () => {
    const { getDocument } = await import('pdfjs-dist')
    const doc = mockPdfjsDoc(2, { Title: 'General Book', Author: 'General Author' }, null);
    doc.getPage.mockImplementation(async (pageNumber: number) => ({
      getViewport: vi.fn(() => ({ width: 595, height: 842 })),
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: `Text from page ${pageNumber}.`, transform: [1,0,0,1,0,800], width: 100, height: 10, fontName: 'f1' }],
      }),
      getOperatorList: vi.fn().mockResolvedValue({ fnArray: [], argsArray: [] }),
      commonObjs: { get: vi.fn(() => ({ name: 'mockFont' })) },
      render: vi.fn().mockResolvedValue({ promise: Promise.resolve() }),
    }));
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve(doc) } as any)

    const result = await service.processPdfDocument(new Blob(['test']), 'General Book', 'General Author');

    expect(NibTextParser).toHaveBeenCalledOnce();
    expect(NibParser).not.toHaveBeenCalled();
    expect(result.type).toBe('text-parsed');
    expect(result.sourceTitle).toBe('General Book');
    expect(result.fullText).toBe('Text from page 1.\n\nText from page 2.');
    expect(doc.getOutline).toHaveBeenCalledOnce();
    expect(doc.getPage).toHaveBeenCalledTimes(2); // For extractAllText
    expect(doc.destroy).toHaveBeenCalledTimes(3); // metadata, outline, allText
  });
});