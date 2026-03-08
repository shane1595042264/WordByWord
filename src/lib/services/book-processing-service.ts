import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import type { Book, Chapter, Section } from '@/lib/db/models'
import { PDFService } from './pdf-service'
import { AIService } from './ai-service'
import { NibService } from './nib-service'

const PAGES_PER_BATCH = 10

interface ImportOptions {
  useNativeTOC: boolean
  onProgress?: (message: string, percent: number) => void
}

export class BookProcessingService {
  private pdfService: PDFService
  private aiService: AIService | null
  private nibService: NibService

  constructor(apiKey?: string) {
    this.pdfService = new PDFService()
    this.aiService = apiKey ? new AIService(apiKey) : null
    this.nibService = new NibService()
  }

  async importBook(blob: Blob, options: ImportOptions): Promise<string> {
    options.onProgress?.('Reading PDF metadata...', 5)
    const metadata = await this.pdfService.extractMetadata(blob)
    options.onProgress?.('Detecting table of contents...', 10)
    const outline = await this.pdfService.extractOutline(blob)

    const book: Book = {
      id: uuid(),
      title: metadata.title,
      author: metadata.author,
      totalPages: metadata.totalPages,
      pdfBlob: blob,
      coverImage: null,
      structureSource: options.useNativeTOC && outline ? 'native' : 'ai',
      processingStatus: 'pending',
      createdAt: Date.now(),
      lastReadAt: null,
    }
    await db.books.add(book)

    if (options.useNativeTOC && outline) {
      await this.buildStructureFromOutline(book.id, outline, metadata.totalPages, blob, options.onProgress)
      await db.books.update(book.id, { processingStatus: 'complete' })
    } else {
      await this.buildDefaultChapters(book.id, metadata.totalPages)
    }

    options.onProgress?.('Done!', 100)
    return book.id
  }

  async processChapterWithAI(bookId: string, chapterId: string): Promise<void> {
    if (!this.aiService) throw new Error('No API key configured')

    const book = await db.books.get(bookId)
    if (!book) throw new Error('Book not found')

    const chapter = await db.chapters.get(chapterId)
    if (!chapter) throw new Error('Chapter not found')

    await db.books.update(bookId, { processingStatus: 'processing' })

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

    const result = await this.aiService.splitPagesIntoSections({
      pageImages,
      pageTexts,
      startPage: chapter.startPage,
      bookTitle: book.title,
      previousSectionTitle: lastSection?.title ?? null,
    })

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

    await db.books.update(bookId, { processingStatus: 'complete' })
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
        // But first, collect any direct leaf children as a standalone chapter
        const directLeaves = children.filter((c: any) => !c.children || c.children.length === 0)
        const nestedChildren = children.filter((c: any) => c.children && c.children.length > 0)

        // If parent starts before its first child, inject an "Introduction" section
        const allChildren = [...directLeaves, ...nestedChildren]
        const firstPage = allChildren.reduce((min: number | null, c: any) => {
          if (c.pageNumber == null) return min
          if (min == null) return c.pageNumber
          return c.pageNumber < min ? c.pageNumber : min
        }, null as number | null)

        const introSections: { title: string; pageNumber: number | null }[] = []
        if (
          item.pageNumber != null &&
          firstPage != null &&
          item.pageNumber < firstPage
        ) {
          introSections.push({
            title: `${item.title} — Introduction`,
            pageNumber: item.pageNumber,
          })
        }

        if (directLeaves.length > 0 || introSections.length > 0) {
          result.push({
            chapterTitle: prefix,
            sections: [
              ...introSections,
              ...directLeaves.map((c: any) => ({ title: c.title, pageNumber: c.pageNumber })),
            ],
          })
        }
        this.walkOutlineTree(nestedChildren, prefix, result)
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

  private async buildDefaultChapters(bookId: string, totalPages: number): Promise<void> {
    const chapters: Chapter[] = []
    for (let start = 1; start <= totalPages; start += PAGES_PER_BATCH) {
      const end = Math.min(start + PAGES_PER_BATCH - 1, totalPages)
      chapters.push({
        id: uuid(),
        bookId,
        title: `Pages ${start}-${end}`,
        order: chapters.length + 1,
        startPage: start,
        endPage: end,
      })
    }
    await db.chapters.bulkAdd(chapters)
  }
}
