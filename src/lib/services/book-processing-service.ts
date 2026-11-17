import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import { syncService } from './sync-service'
import type { Book, Chapter, Section } from '@/lib/db/models'
import { PDFService } from './pdf-service'
import { NibService } from './nib-service'
import { aiErrorFromResponse, AiApiError } from './ai-api'

const PAGES_PER_BATCH = 10
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
/** nibble-api's /ai/split-sections cap on one page's extracted text. */
const MAX_PAGE_TEXT_CHARS = 20_000

const stripDataUrl = (img: string) => img.replace(/^data:image\/\w+;base64,/, '')

async function authToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/token')
    if (!res.ok) return null
    return (await res.json())?.token ?? null
  } catch {
    return null
  }
}

/**
 * OCR page images through nibble-api, on the reader's own AI key (BYOK).
 * Never throws: a failed batch comes back as empty texts, and `problem` says
 * why when the reader can fix it (no key, no image-capable key, refused key),
 * so the import can say so instead of quietly importing blank pages.
 */
async function ocrViaBackend(base64Images: string[]): Promise<{ texts: string[]; problem: string | null }> {
  const empty = (problem: string | null = null) => ({ texts: base64Images.map(() => ''), problem })
  const token = await authToken()
  if (!token) return empty('you are signed out')
  try {
    const res = await fetch(`${API_URL}/ai/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ images: base64Images.map(stripDataUrl) }),
    })
    if (!res.ok) {
      const err = await aiErrorFromResponse(res, { failed: 'OCR failed' })
      return empty(err.needsKeySetup ? err.message : null)
    }
    const data = await res.json()
    return { texts: data.texts ?? base64Images.map(() => ''), problem: null }
  } catch {
    return empty()
  }
}

interface SplitSectionsResult {
  sections: Array<{ title: string; startPage: number; endPage: number; summary: string }>
}

/** One batch of at most PAGES_PER_BATCH pages, split into study-sized sections on the reader's key. */
async function splitSectionsViaBackend(input: {
  pageImages: string[]
  pageTexts: string[]
  startPage: number
  bookTitle: string
  previousSectionTitle: string | null
}): Promise<SplitSectionsResult> {
  const token = await authToken()
  if (!token) throw new AiApiError('You are signed out. Sign in again and retry.', 401, 'UNAUTHORIZED')
  const res = await fetch(`${API_URL}/ai/split-sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      pageImages: input.pageImages.map(stripDataUrl),
      pageTexts: input.pageTexts.map(t => t.slice(0, MAX_PAGE_TEXT_CHARS)),
      startPage: input.startPage,
      bookTitle: input.bookTitle.slice(0, 500),
      previousSectionTitle: input.previousSectionTitle?.slice(0, 500) ?? null,
    }),
  })
  if (!res.ok) throw await aiErrorFromResponse(res, { failed: 'Section splitting failed' })
  const data = await res.json()
  return { sections: Array.isArray(data?.sections) ? data.sections : [] }
}

interface ImportOptions {
  useNativeTOC: boolean
  useNibProcess?: boolean
  onProgress?: (message: string, percent: number) => void
}

export class BookProcessingService {
  private pdfService: PDFService
  private nibService: NibService

  constructor() {
    this.pdfService = new PDFService()
    this.nibService = new NibService()
  }

  /** Render PDF page 1 as a cover image (base64 data URL) */
  private async generateCover(blob: Blob): Promise<string | null> {
    try {
      return await this.pdfService.renderPageToImage(blob, 1, 1.5)
    } catch {
      return null
    }
  }

  async importBook(blob: Blob, options: ImportOptions): Promise<string> {
    options.onProgress?.('Reading PDF metadata...', 5)
    const metadata = await this.pdfService.extractMetadata(blob)
    options.onProgress?.('Detecting table of contents...', 10)
    const outline = await this.pdfService.extractOutline(blob)

    const structureSource = (options.useNativeTOC && outline) ? 'native'
      : options.useNibProcess ? 'native'
      : 'manual'

    const book: Book = {
      id: uuid(),
      title: metadata.title,
      author: metadata.author,
      totalPages: metadata.totalPages,
      pdfBlob: blob,
      coverImage: await this.generateCover(blob),
      structureSource,
      processingStatus: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastReadAt: null,
      lastAccessedSectionId: null,
      lastAccessedScrollProgress: null,
      lastAccessedWordIndex: null,
      completedAt: null,
    }
    await db.books.add(book)

    if (options.useNativeTOC && outline) {
      await this.buildStructureFromOutline(book.id, outline, metadata.totalPages, blob, options.onProgress)
    } else if (options.useNibProcess) {
      // NIB Process: use the rich NibParser for all pages (no AI needed)
      // If there's a TOC outline, use it for structure; otherwise do page-by-page with NIB
      if (outline && outline.length > 0) {
        await this.buildStructureFromOutline(book.id, outline, metadata.totalPages, blob, options.onProgress)
      } else {
        const savedBook = await db.books.get(book.id)
        const freshBlob = savedBook?.pdfBlob ?? blob
        await this.buildNibChapters(book.id, metadata.totalPages, freshBlob, metadata.title, metadata.author, options.onProgress)
      }
    } else {
      // Re-read blob from DB to ensure it's a fresh copy (File objects can get detached)
      const savedBook = await db.books.get(book.id)
      const freshBlob = savedBook?.pdfBlob ?? blob
      await this.buildDefaultChapters(book.id, metadata.totalPages, freshBlob, metadata.title, metadata.author, options.onProgress)
    }
    await db.books.update(book.id, { processingStatus: 'complete', updatedAt: Date.now() })

    // Upload PDF to backend and sync structure
    options.onProgress?.('Syncing to cloud...', 95)
    try {
      const pdfFile = new File([blob], `${metadata.title}.pdf`, { type: 'application/pdf' })
      const uploadResult = await syncService.uploadBook(pdfFile, metadata.title, metadata.author, metadata.totalPages)
      if (uploadResult) {
        const updateData: Partial<Book> = {
          remoteId: uploadResult.remoteId,
          catalogId: uploadResult.catalogId,
          updatedAt: Date.now(),
        }
        // If backend found a Google Books cover, use it (better quality than PDF page 1)
        if (uploadResult.coverUrl) {
          updateData.coverImage = uploadResult.coverUrl
        }
        await db.books.update(book.id, updateData)
        // Immediate sync to push chapters and sections
        await syncService.sync()
      }
    } catch (err) {
      console.error('[sync] upload after processing failed:', err)
      // Non-blocking — local data is fine, sync will retry later
    }

    options.onProgress?.('Done!', 100)
    return book.id
  }

  async processChapterWithAI(bookId: string, chapterId: string): Promise<void> {
    const book = await db.books.get(bookId)
    if (!book) throw new Error('Book not found')
    if (!book.pdfBlob) throw new Error('AI chapter processing requires a PDF source (not supported for EPUB books)')

    const chapter = await db.chapters.get(chapterId)
    if (!chapter) throw new Error('Chapter not found')

    await db.books.update(bookId, { processingStatus: 'processing', updatedAt: Date.now() })

    const pageImages: string[] = []
    const pageTexts: string[] = []

    for (let page = chapter.startPage; page <= chapter.endPage; page++) {
      const image = await this.pdfService.renderPageToImage(book.pdfBlob, page)
      const text = await this.pdfService.extractPageText(book.pdfBlob, page)
      pageImages.push(image)
      pageTexts.push(text)
    }

    const existingSections = await db.sections
      .where('bookId').equals(bookId)
      .sortBy('order')
    const lastSection = existingSections.length > 0
      ? existingSections[existingSections.length - 1]
      : null

    // nibble-api takes at most a dozen page images per call, so a long chapter
    // goes in batches, each told where the previous one left off.
    const result: SplitSectionsResult = { sections: [] }
    let previousSectionTitle = lastSection?.title ?? null
    for (let i = 0; i < pageImages.length; i += PAGES_PER_BATCH) {
      const batch = await splitSectionsViaBackend({
        pageImages: pageImages.slice(i, i + PAGES_PER_BATCH),
        pageTexts: pageTexts.slice(i, i + PAGES_PER_BATCH),
        startPage: chapter.startPage + i,
        bookTitle: book.title,
        previousSectionTitle,
      })
      result.sections.push(...batch.sections)
      previousSectionTitle = batch.sections.at(-1)?.title ?? previousSectionTitle
    }

    const baseOrder = existingSections.length
    const sections: Section[] = result.sections.map((s, i) => {
      // Stitch together the actual extracted text for this section's page range
      const sectionTexts: string[] = []
      for (let p = s.startPage; p <= s.endPage; p++) {
        const idx = p - chapter.startPage
        if (idx >= 0 && idx < pageTexts.length && pageTexts[idx].trim()) {
          sectionTexts.push(pageTexts[idx])
        }
      }
      return {
        id: uuid(),
        chapterId,
        bookId,
        title: s.title,
        order: baseOrder + i + 1,
        startPage: s.startPage,
        endPage: s.endPage,
        extractedText: sectionTexts.join('\n\n') || null,
        isRead: false,
        readAt: null,
        lastPageViewed: null,
        scrollProgress: null,
        updatedAt: Date.now(),
      }
    })

    await db.sections.bulkAdd(sections)
  }

  async processAllChaptersWithAI(
    bookId: string,
    onProgress?: (processed: number, total: number) => void,
    priorityChapterId?: string,
  ): Promise<void> {
    const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('order')

    try {
      if (priorityChapterId) {
        const priorityChapter = chapters.find(c => c.id === priorityChapterId)
        if (priorityChapter) {
          await this.processChapterWithAI(bookId, priorityChapter.id)
          onProgress?.(1, chapters.length)
        }
      }

      let processed = priorityChapterId ? 1 : 0
      for (const chapter of chapters) {
        if (chapter.id === priorityChapterId) continue
        const existingSections = await db.sections.where('chapterId').equals(chapter.id).count()
        if (existingSections > 0) { processed++; continue }
        await this.processChapterWithAI(bookId, chapter.id)
        processed++
        onProgress?.(processed, chapters.length)
      }

      await db.books.update(bookId, { processingStatus: 'complete', updatedAt: Date.now() })
    } catch (err) {
      // processChapterWithAI flips the book to 'processing' before doing any work.
      // Without this reset a single failure (Anthropic 429, network drop, bad page,
      // EPUB source) leaves the row on 'processing' forever, which hides the library
      // card's link wrapper and strands the book with no way back. 'error' is a
      // terminal state the card renders as "Processing failed / Tap to review" and
      // still links through to /book/[id], where the retry button lives.
      try {
        await db.books.update(bookId, { processingStatus: 'error', updatedAt: Date.now() })
      } catch (resetErr) {
        console.error('[processing] failed to reset processingStatus after error:', resetErr)
      }
      throw err
    }
  }

  /**
   * Walk the outline tree and dynamically build chapters + sections
   * based on the book's actual structure.
   *
   * Strategy:
   * - Leaf nodes (no children) → become sections
   * - Nodes whose children are all leaves → become chapters, children become sections
   * - Nodes with deeper nesting → recurse; they're grouping levels (e.g. "Part 1")
   *   that get flattened into chapter titles like "Part 1 > Chapter 1"
   */
  private async buildStructureFromOutline(
    bookId: string,
    outline: { title: string; pageNumber: number | null; children: any[] }[],
    totalPages: number,
    blob: Blob,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    // Fetch book metadata for nib parsing
    const bookRecord = await db.books.get(bookId)

    // First, flatten the entire outline into an ordered list to compute page ranges
    const allItems = this.flattenOutline(outline)
    const pageMap = new Map<string, number>()
    allItems.forEach((item, i) => {
      if (item.pageNumber != null) {
        pageMap.set(item.title + '_' + i, item.pageNumber)
      }
    })

    // Collect chapter/section pairs by walking the tree
    const result: { chapterTitle: string; sections: { title: string; pageNumber: number | null }[] }[] = []
    this.walkOutlineTree(outline, '', result)

    // Now compute page ranges and create DB records
    // Build a flat ordered list of ALL leaf titles with page numbers for range computation
    const allLeaves: { title: string; pageNumber: number | null; chapterIdx: number; sectionIdx: number }[] = []
    result.forEach((ch, ci) => {
      ch.sections.forEach((s, si) => {
        allLeaves.push({ title: s.title, pageNumber: s.pageNumber, chapterIdx: ci, sectionIdx: si })
      })
    })

    let chapterOrder = 0
    let sectionOrder = 0

    onProgress?.('Building structure...', 15)

    for (let ci = 0; ci < result.length; ci++) {
      const ch = result[ci]
      const percent = 15 + Math.round((ci / result.length) * 80)
      onProgress?.(`Extracting text: ${ch.chapterTitle}`, percent)
      // Compute chapter page range from its sections
      const chapterSections = allLeaves.filter(l => l.chapterIdx === ci)
      const firstPage = chapterSections[0]?.pageNumber ?? 1
      // Find the next section AFTER this chapter to determine endPage
      const lastSectionGlobalIdx = allLeaves.findIndex(
        l => l.chapterIdx === ci && l.sectionIdx === ch.sections.length - 1
      )
      const nextLeaf = allLeaves[lastSectionGlobalIdx + 1]
      const endPage = nextLeaf?.pageNumber != null
        ? nextLeaf.pageNumber - 1
        : totalPages

      const chapterId = uuid()
      const chapter: Chapter = {
        id: chapterId,
        bookId,
        title: ch.chapterTitle,
        order: ++chapterOrder,
        startPage: firstPage,
        endPage: Math.max(firstPage, endPage),
        updatedAt: Date.now(),
      }
      await db.chapters.add(chapter)

      // Create sections with extracted text
      for (let si = 0; si < ch.sections.length; si++) {
        const sec = ch.sections[si]
        const startPage = sec.pageNumber ?? firstPage
        // Next section's page determines this section's end
        const nextSec = ch.sections[si + 1]
        let secEndPage: number
        if (nextSec?.pageNumber != null) {
          secEndPage = nextSec.pageNumber - 1
        } else if (si === ch.sections.length - 1) {
          // Last section in chapter — find next chapter's start
          const nextChSections = result[ci + 1]?.sections
          if (nextChSections?.[0]?.pageNumber != null) {
            secEndPage = nextChSections[0].pageNumber - 1
          } else {
            secEndPage = endPage
          }
        } else {
          secEndPage = endPage
        }
        secEndPage = Math.max(startPage, secEndPage)

        // Extract clean text for this section's pages using .nib parser
        // (removes headers, footers, footnotes — gives clean body text)
        let sectionText: string | null = null
        try {
          const cleanText = await this.nibService.getCleanText(
            blob, startPage, secEndPage, bookRecord?.title ?? '', bookRecord?.author ?? ''
          )
          sectionText = cleanText.trim() || null
        } catch {
          // Fallback: extract raw text if nib parsing fails
          const pageTexts: string[] = []
          for (let p = startPage; p <= secEndPage; p++) {
            const text = await this.pdfService.extractPageText(blob, p)
            if (text.trim()) pageTexts.push(text)
          }
          sectionText = pageTexts.join('\n\n') || null
        }

        const section: Section = {
          id: uuid(),
          chapterId,
          bookId,
          title: sec.title,
          order: ++sectionOrder,
          startPage,
          endPage: secEndPage,
          extractedText: sectionText,
          isRead: false,
          readAt: null,
          lastPageViewed: null,
          scrollProgress: null,
          updatedAt: Date.now(),
        }
        await db.sections.add(section)
      }
    }
  }

  private walkOutlineTree(
    items: { title: string; pageNumber: number | null; children: any[] }[],
    parentPrefix: string,
    result: { chapterTitle: string; sections: { title: string; pageNumber: number | null }[] }[],
  ): void {
    for (const item of items) {
      const children = item.children || []
      if (children.length === 0) {
        // Leaf node with no parent chapter yet → standalone chapter with one section
        result.push({
          chapterTitle: item.title,
          sections: [{ title: item.title, pageNumber: item.pageNumber }],
        })
      } else if (children.every((c: any) => !c.children || c.children.length === 0)) {
        // All children are leaves → this is a chapter, children are sections
        const title = parentPrefix ? `${parentPrefix} > ${item.title}` : item.title
        const sections: { title: string; pageNumber: number | null }[] = []

        // If the parent starts on an earlier page than its first child,
        // inject an "Introduction" section to capture that gap text.
        const firstChildPage = children[0]?.pageNumber ?? null
        if (
          item.pageNumber != null &&
          firstChildPage != null &&
          item.pageNumber < firstChildPage
        ) {
          sections.push({
            title: `${item.title} — Introduction`,
            pageNumber: item.pageNumber,
          })
        }

        for (const c of children) {
          sections.push({ title: c.title, pageNumber: c.pageNumber })
        }

        result.push({ chapterTitle: title, sections })
      } else {
        // Has nested children → grouping level, recurse
        const prefix = parentPrefix ? `${parentPrefix} > ${item.title}` : item.title

        // If parent starts before its first child, inject an "Introduction" section
        const firstPage = children.reduce((min: number | null, c: any) => {
          if (c.pageNumber == null) return min
          if (min == null) return c.pageNumber
          return c.pageNumber < min ? c.pageNumber : min
        }, null as number | null)

        let pending: { title: string; pageNumber: number | null }[] = []
        if (
          item.pageNumber != null &&
          firstPage != null &&
          item.pageNumber < firstPage
        ) {
          pending.push({
            title: `${item.title} — Introduction`,
            pageNumber: item.pageNumber,
          })
        }

        // Walk children in outline order (KAN-384): consecutive direct leaves
        // share a chapter, and each nested child recurses in place, so the flat
        // leaf list — and every page range computed from it — stays in document
        // order. A trailing leaf run (e.g. "Summary") becomes its own chapter.
        const flush = () => {
          if (pending.length > 0) {
            result.push({ chapterTitle: prefix, sections: pending })
            pending = []
          }
        }
        for (const c of children) {
          if (c.children && c.children.length > 0) {
            flush()
            this.walkOutlineTree([c], prefix, result)
          } else {
            pending.push({ title: c.title, pageNumber: c.pageNumber })
          }
        }
        flush()
      }
    }
  }

  private flattenOutline(items: any[]): { title: string; pageNumber: number | null }[] {
    const result: { title: string; pageNumber: number | null }[] = []
    for (const item of items) {
      result.push({ title: item.title, pageNumber: item.pageNumber })
      if (item.children?.length) {
        result.push(...this.flattenOutline(item.children))
      }
    }
    return result
  }

  /**
   * Build chapters using the rich NibParser (font/position-aware) for PDFs without TOC.
   * Groups pages into chapters and extracts clean text via NibService — no AI needed.
   * This gives much better text quality than raw PDF.js extraction since it strips
   * headers, footers, footnotes, and properly joins paragraphs across pages.
   */
  private async buildNibChapters(
    bookId: string,
    totalPages: number,
    blob: Blob,
    bookTitle: string,
    bookAuthor: string,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    let sectionOrder = 0

    for (let start = 1; start <= totalPages; start += PAGES_PER_BATCH) {
      const end = Math.min(start + PAGES_PER_BATCH - 1, totalPages)
      const chapterId = uuid()
      const percent = 15 + Math.round(((start - 1) / totalPages) * 80)
      onProgress?.(`NIB processing: pages ${start}-${end}`, percent)

      const chapter: Chapter = {
        id: chapterId,
        bookId,
        title: `Pages ${start}-${end}`,
        order: Math.ceil(start / PAGES_PER_BATCH),
        startPage: start,
        endPage: end,
        updatedAt: Date.now(),
      }
      await db.chapters.add(chapter)

      // Use NibService rich parsing for each page — extracts clean text with
      // header/footer/footnote removal and proper paragraph joining
      for (let page = start; page <= end; page++) {
        let sectionText: string | null = null

        try {
          const cleanText = await this.nibService.getCleanText(
            blob, page, page, bookTitle, bookAuthor,
          )
          if (cleanText && cleanText.trim().length > 0) {
            sectionText = cleanText.trim()
          }
        } catch {
          // Fallback: try raw PDF.js text extraction
          try {
            const rawText = await this.pdfService.extractPageText(blob, page)
            if (rawText && rawText.trim().length > 0) {
              sectionText = rawText.trim()
            }
          } catch {
            // Page has no extractable text (image-only)
          }
        }

        const section: Section = {
          id: uuid(),
          chapterId,
          bookId,
          title: `Page ${page}`,
          order: ++sectionOrder,
          startPage: page,
          endPage: page,
          extractedText: sectionText,
          isRead: false,
          readAt: null,
          lastPageViewed: null,
          scrollProgress: null,
          updatedAt: Date.now(),
        }
        await db.sections.add(section)
      }
    }
  }

  private async buildDefaultChapters(
    bookId: string,
    totalPages: number,
    blob: Blob,
    bookTitle: string,
    bookAuthor: string,
    onProgress?: (message: string, percent: number) => void,
  ): Promise<void> {
    let sectionOrder = 0

    for (let start = 1; start <= totalPages; start += PAGES_PER_BATCH) {
      const end = Math.min(start + PAGES_PER_BATCH - 1, totalPages)
      const chapterId = uuid()
      const percent = 15 + Math.round(((start - 1) / totalPages) * 80)
      onProgress?.(`Extracting text: pages ${start}-${end}`, percent)

      const chapter: Chapter = {
        id: chapterId,
        bookId,
        title: `Pages ${start}-${end}`,
        order: Math.ceil(start / PAGES_PER_BATCH),
        startPage: start,
        endPage: end,
        updatedAt: Date.now(),
      }
      await db.chapters.add(chapter)

      // First pass: try PDF.js text extraction for all pages in this chapter
      const pageTexts: (string | null)[] = []
      const needsOcrPages: number[] = [] // page numbers that need Vision OCR

      for (let page = start; page <= end; page++) {
        let extractedText: string | null = null

        // Try raw PDF.js text extraction
        try {
          const rawText = await this.pdfService.extractPageText(blob, page)
          if (rawText && rawText.trim().length > 0) {
            extractedText = rawText.trim()
          }
        } catch {
          // PDF.js extraction failed
        }

        // Try NibService clean text
        if (!extractedText) {
          try {
            const cleanText = await this.nibService.getCleanText(
              blob, page, page, bookTitle, bookAuthor,
            )
            if (cleanText && cleanText.trim().length > 0) {
              extractedText = cleanText.trim()
            }
          } catch {
            // NibService extraction failed
          }
        }

        pageTexts.push(extractedText)
        if (!extractedText) {
          needsOcrPages.push(page)
        }
      }

      // Second pass: if any pages have no text, try OCR
      if (needsOcrPages.length > 0) {
        onProgress?.(`OCR: rendering ${needsOcrPages.length} image-based pages...`, percent + 3)

        // Render pages to images
        const pageImages: string[] = []
        for (const page of needsOcrPages) {
          try {
            const image = await this.pdfService.renderPageToImage(blob, page, 2)
            pageImages.push(image)
          } catch {
            pageImages.push('')
          }
        }

        const validImages = pageImages.filter(img => img.length > 0)
        if (validImages.length > 0) {
          let ocrTexts: string[] = []

          // OCR runs on the reader's own AI key, server-side (BYOK).
          onProgress?.(`OCR: extracting text with AI (${validImages.length} pages)...`, percent + 5)
          const ocrResult = await ocrViaBackend(validImages)

          if (ocrResult.problem) {
            onProgress?.(`OCR skipped (${ocrResult.problem}) — scanned pages imported without text. Use PDF view.`, percent + 5)
          } else if (ocrResult.texts.some(t => t && t.trim().length > 0)) {
            ocrTexts = ocrResult.texts
          } else {
            onProgress?.('OCR failed — scanned pages imported without text. Use PDF view.', percent + 5)
          }

          // Map OCR results back to the right pages
          if (ocrTexts.length > 0) {
            let ocrIdx = 0
            for (let i = 0; i < needsOcrPages.length; i++) {
              if (pageImages[i].length > 0 && ocrIdx < ocrTexts.length) {
                const ocrText = ocrTexts[ocrIdx]?.trim()
                if (ocrText && ocrText.length > 0) {
                  const pageIdx = needsOcrPages[i] - start
                  pageTexts[pageIdx] = ocrText
                }
                ocrIdx++
              }
            }
          }
        }
      }

      // Create sections with whatever text we got
      for (let page = start; page <= end; page++) {
        const pageIdx = page - start
        const section: Section = {
          id: uuid(),
          chapterId,
          bookId,
          title: `Page ${page}`,
          order: ++sectionOrder,
          startPage: page,
          endPage: page,
          extractedText: pageTexts[pageIdx],
          isRead: false,
          readAt: null,
          lastPageViewed: null,
          scrollProgress: null,
          updatedAt: Date.now(),
        }
        await db.sections.add(section)
      }
    }
  }
}
