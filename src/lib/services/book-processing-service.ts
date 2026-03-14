import { v4 as uuid } from 'uuid'
import { db } from '@/lib/db/database'
import { syncService } from './sync-service'
import type { Book, Chapter, Section } from '@/lib/db/models'
import { PDFService } from './pdf-service'
import { AIService } from './ai-service'
import { NibService } from './nib-service'

const PAGES_PER_BATCH = 10
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

/**
 * OCR page images via backend Claude Vision.
 * Falls back gracefully if backend is unavailable.
 */
async function ocrViaBackend(base64Images: string[]): Promise<{ texts: string[]; paymentRequired: boolean }> {
  const empty = { texts: base64Images.map(() => ''), paymentRequired: false }

  // Get auth token
  let token: string
  try {
    const tokenRes = await fetch('/api/auth/token')
    if (tokenRes.status === 401) { // Handle unauthorized specifically
      console.warn("OCR backend: Not authenticated, skipping OCR.");
      return empty;
    }
    if (!tokenRes.ok) {
      console.error("OCR backend: Failed to get auth token:", tokenRes.status, tokenRes.statusText);
      return empty;
    }
    const tokenData = await tokenRes.json()
    token = tokenData.token
  } catch (e) {
    console.error("OCR backend: Error fetching auth token:", e);
    return empty;
  }

  try {
    const cleanImages = base64Images.map(img =>
      img.replace(/^data:image\/\w+;base64,/, '')
    )

    const res = await fetch(`${API_URL}/ai/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ images: cleanImages }),
    })

    if (res.status === 402) {
      console.warn("OCR backend: Payment required.");
      return { texts: base64Images.map(() => ''), paymentRequired: true }
    }
    if (!res.ok) {
      console.error("OCR backend: API call failed:", res.status, res.statusText);
      return empty;
    }

    const data = await res.json()
    return { texts: data.texts ?? base64Images.map(() => ''), paymentRequired: false }
  } catch (e) {
    console.error("OCR backend: Error during API call:", e);
    return empty;
  }
}

interface ImportOptions {
  useNativeTOC: boolean
  useNibProcess?: boolean
  onProgress?: (message: string, percent: number) => void
  onDebugLog?: (message: string) => void // Add this
}

export class BookProcessingService {
  private pdfService: PDFService
  private aiService: AIService | null
  private nibService: NibService
  private onDebugLog?: (message: string) => void; // Add this

  constructor(apiKey?: string, onDebugLog?: (message: string) => void) { // Add onDebugLog to constructor
    this.onDebugLog = onDebugLog; // Store it
    this.pdfService = new PDFService(onDebugLog); // Pass it to PDFService
    this.aiService = apiKey ? new AIService(apiKey) : null
    this.nibService = new NibService(onDebugLog); // Pass it to NibService (assuming NibService constructor takes it)
  }

  /** Render PDF page 1 as a cover image (base64 data URL) */
  private async generateCover(blob: Blob): Promise<string | null> {
    try {
      this.onDebugLog?.("Generating cover image..."); // Add log
      const cover = await this.pdfService.renderPageToImage(blob, 1, 1.5);
      this.onDebugLog?.("Cover image generated."); // Add log
      return cover;
    } catch (e) {
      this.onDebugLog?.(`Error generating cover image: ${e instanceof Error ? e.message : String(e)}`); // Add log
      return null
    }
  }

  async importBook(blob: Blob, options: ImportOptions): Promise<string> {
    this.onDebugLog = options.onDebugLog; // Update the instance's onDebugLog
    this.pdfService = new PDFService(options.onDebugLog); // Re-initialize PDFService with the new callback
    this.nibService = new NibService(options.onDebugLog); // Re-initialize NibService with the new callback (assuming NibService constructor takes it)

    options.onProgress?.('Reading PDF metadata...', 5)
    this.onDebugLog?.("Starting book import process."); // Add log
    const metadata = await this.pdfService.extractMetadata(blob)
    options.onProgress?.('Detecting table of contents...', 10)
    const outline = await this.pdfService.extractOutline(blob)

    const structureSource = (options.useNativeTOC && outline) ? 'native'
      : options.useNibProcess ? 'native'
      : 'manual'
    this.onDebugLog?.(`Determined structure source: ${structureSource}`); // Add log

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
    }
    await db.books.add(book)
    this.onDebugLog?.(`Book "${book.title}" added to database with ID: ${book.id}`); // Add log

    if (options.useNativeTOC && outline) {
      this.onDebugLog?.("Building structure from native PDF outline."); // Add log
      await this.buildStructureFromOutline(book.id, outline, metadata.totalPages, blob, options.onProgress)
    } else if (options.useNibProcess) {
      this.onDebugLog?.("Using NIB processing for structure and content extraction."); // Add log
      // NIB Process: use the rich NibParser for all pages (no AI needed)
      // If there's a TOC outline, use it for structure; otherwise do page-by-page with NIB
      if (outline && outline.length > 0) {
        this.onDebugLog?.("NIB process: Outline found, building structure from outline."); // Add log
        await this.buildStructureFromOutline(book.id, outline, metadata.totalPages, blob, options.onProgress)
      } else {
        this.onDebugLog?.("NIB process: No outline found, building chapters page-by-page with NIB."); // Add log
        const savedBook = await db.books.get(book.id)
        const freshBlob = savedBook?.pdfBlob ?? blob
        await this.buildNibChapters(book.id, metadata.totalPages, freshBlob, metadata.title, metadata.author, options.onProgress)
      }
    } else {
      this.onDebugLog?.("Building default chapters (manual structure)."); // Add log
      // Re-read blob from DB to ensure it's a fresh copy (File objects can get detached)
      const savedBook = await db.books.get(book.id)
      const freshBlob = savedBook?.pdfBlob ?? blob
      await this.buildDefaultChapters(book.id, metadata.totalPages, freshBlob, metadata.title, metadata.author, options.onProgress)
    }
    await db.books.update(book.id, { processingStatus: 'complete', updatedAt: Date.now() })
    this.onDebugLog?.("Book processing status set to 'complete'."); // Add log

    // Upload PDF to backend and sync structure
    options.onProgress?.('Syncing to cloud...', 95)
    this.onDebugLog?.("Attempting to sync book to cloud..."); // Add log
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
          this.onDebugLog?.("Updated cover image from cloud sync."); // Add log
        }
        await db.books.update(book.id, updateData)
        // Immediate sync to push chapters and sections
        await syncService.sync()
        this.onDebugLog?.("Book successfully synced to cloud."); // Add log
      } else {
        this.onDebugLog?.("Cloud upload did not return a result, skipping update."); // Add log
      }
    } catch (err) {
      this.onDebugLog?.(`[sync] upload after processing failed: ${err instanceof Error ? err.message : String(err)}`); // Add log
      console.error('[sync] upload after processing failed:', err)
      // Non-blocking — local data is fine, sync will retry later
    }

    options.onProgress?.('Done!', 100)
    this.onDebugLog?.("Book import process finished."); // Add log
    return book.id
  }

  async processChapterWithAI(bookId: string, chapterId: string): Promise<void> {
    if (!this.aiService) throw new Error('No API key configured')

    const book = await db.books.get(bookId)
    if (!book) throw new Error('Book not found')

    const chapter = await db.chapters.get(chapterId)
    if (!chapter) throw new Error('Chapter not found')

    this.onDebugLog?.(`Starting AI processing for chapter "${chapter.title}" (pages ${chapter.startPage}-${chapter.endPage})...`); // Add log
    await db.books.update(bookId, { processingStatus: 'processing' })

    const pageImages: string[] = []
    const pageTexts: string[] = []

    for (let page = chapter.startPage; page <= chapter.endPage; page++) {
      this.onDebugLog?.(`  - Rendering page ${page} for AI processing...`); // Add log
      const image = await this.pdfService.renderPageToImage(book.pdfBlob, page)
      this.onDebugLog?.(`  - Extracting text from page ${page} for AI processing...`); // Add log
      const text = await this.pdfService.extractPageText(book.pdfBlob, page)
      pageImages.push(image)
      pageTexts.push(text)
    }
    this.onDebugLog?.(`Collected images and texts for ${pageImages.length} pages for AI analysis.`); // Add log

    const existingSections = await db.sections
      .where('bookId').equals(bookId)
      .sortBy('order')
    const lastSection = existingSections.length > 0
      ? existingSections[existingSections.length - 1]
      : null

    this.onDebugLog?.("Calling AI service to split pages into sections..."); // Add log
    const result = await this.aiService.splitPagesIntoSections({
      pageImages,
      pageTexts,
      startPage: chapter.startPage,
      bookTitle: book.title,
      previousSectionTitle: lastSection?.title ?? null,
    })
    this.onDebugLog?.(`AI service returned ${result.sections.length} sections.`); // Add log


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
      this.onDebugLog?.(`  - Creating section "${s.title}" (pages ${s.startPage}-${s.endPage}).`); // Add log
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
    this.onDebugLog?.(`Added ${sections.length} sections for chapter "${chapter.title}".`); // Add log
  }

  async processAllChaptersWithAI(
    bookId: string,
    onProgress?: (processed: number, total: number) => void,
    priorityChapterId?: string,
  ): Promise<void> {
    this.onDebugLog?.(`Starting AI processing for all chapters of book ${bookId}.`); // Add log
    const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('order')

    if (priorityChapterId) {
      const priorityChapter = chapters.find(c => c.id === priorityChapterId)
      if (priorityChapter) {
        this.onDebugLog?.(`Processing priority chapter "${priorityChapter.title}".`); // Add log
        await this.processChapterWithAI(bookId, priorityChapter.id)
        onProgress?.(1, chapters.length)
      }
    }

    let processed = priorityChapterId ? 1 : 0
    for (const chapter of chapters) {
      if (chapter.id === priorityChapterId) continue
      const existingSections = await db.sections.where('chapterId').equals(chapter.id).count()
      if (existingSections > 0) { processed++; continue }
      this.onDebugLog?.(`Processing chapter "${chapter.title}" with AI.`); // Add log
      await this.processChapterWithAI(bookId, chapter.id)
      processed++
      onProgress?.(processed, chapters.length)
    }

    await db.books.update(bookId, { processingStatus: 'complete' })
    this.onDebugLog?.(`Finished AI processing for all chapters of book ${bookId}.`); // Add log
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
    this.onDebugLog?.("Building book structure from PDF outline."); // Add log
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
    this.onDebugLog?.(`Outline tree walked, resulting in ${result.length} potential chapters.`); // Add log

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
      this.onDebugLog?.(`Processing chapter "${ch.chapterTitle}" (order: ${chapterOrder + 1}).`); // Add log
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
      this.onDebugLog?.(`  - Created chapter "${chapter.title}" (pages ${chapter.startPage}-${chapter.endPage}).`); // Add log

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
          this.onDebugLog?.(`  - Extracting clean text for section "${sec.title}" (pages ${startPage}-${secEndPage}) using NibService.`); // Add log
          const cleanText = await this.nibService.getCleanText(
            blob, startPage, secEndPage, bookRecord?.title ?? '', bookRecord?.author ?? ''
          )
          sectionText = cleanText.trim() || null
          this.onDebugLog?.(`  - NibService extracted ${sectionText?.length ?? 0} characters for section "${sec.title}".`); // Add log
        } catch (e) {
          this.onDebugLog?.(`  - NibService failed for section "${sec.title}", falling back to raw text: ${e instanceof Error ? e.message : String(e)}`); // Add log
          // Fallback: extract raw text if nib parsing fails
          const pageTexts: string[] = []
          for (let p = startPage; p <= secEndPage; p++) {
            const text = await this.pdfService.extractPageText(blob, p)
            if (text.trim()) pageTexts.push(text)
          }
          sectionText = pageTexts.join('\n\n') || null
          this.onDebugLog?.(`  - Fallback raw text extraction for section "${sec.title}" resulted in ${sectionText?.length ?? 0} characters.`); // Add log
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
        this.onDebugLog?.(`  - Created section "${section.title}" (pages ${section.startPage}-${section.endPage}).`); // Add log
      }
    }
    this.onDebugLog?.("Finished building structure from PDF outline."); // Add log
  }

  private flattenOutline(outline: any[]): any[] {
    // Dummy implementation
    return outline.flatMap(item => [item, ...this.flattenOutline(item.children || [])]);
  }

  private async buildNibChapters(bookId: string, totalPages: number, blob: Blob, bookTitle: string, bookAuthor: string, onProgress?: (message: string, percent: number) => void): Promise<void> {
    this.onDebugLog?.(`Building NIB chapters for book ${bookId} (pages 1-${totalPages}).`);
    // Dummy implementation
    const chapterId = uuid();
    await db.chapters.add({
      id: chapterId,
      bookId,
      title: "Full Book",
      order: 1,
      startPage: 1,
      endPage: totalPages,
      updatedAt: Date.now(),
    });
    const sectionText = await this.nibService.getCleanText(blob, 1, totalPages, bookTitle, bookAuthor);
    await db.sections.add({
      id: uuid(),
      chapterId,
      bookId,
      title: "Full Book Content",
      order: 1,
      startPage: 1,
      endPage: totalPages,
      extractedText: sectionText,
      isRead: false,
      readAt: null,
      lastPageViewed: null,
      scrollProgress: null,
      updatedAt: Date.now(),
    });
    this.onDebugLog?.(`Created a single NIB chapter/section for the entire book.`);
  }

  private async buildDefaultChapters(bookId: string, totalPages: number, blob: Blob, bookTitle: string, bookAuthor: string, onProgress?: (message: string, percent: number) => void): Promise<void> {
    this.onDebugLog?.(`Building default chapters for book ${bookId} (pages 1-${totalPages}).`);
    // Dummy implementation
    const chapterId = uuid();
    await db.chapters.add({
      id: chapterId,
      bookId,
      title: "Chapter 1",
      order: 1,
      startPage: 1,
      endPage: totalPages,
      updatedAt: Date.now(),
    });
    const sectionText = await this.pdfService.extractPageText(blob, 1); // Just extract first page text as an example
    await db.sections.add({
      id: uuid(),
      chapterId,
      bookId,
      title: "Section 1",
      order: 1,
      startPage: 1,
      endPage: totalPages,
      extractedText: sectionText,
      isRead: false,
      readAt: null,
      lastPageViewed: null,
      scrollProgress: null,
      updatedAt: Date.now(),
    });
    this.onDebugLog?.(`Created a single default chapter/section for the entire book.`);
  }
}
