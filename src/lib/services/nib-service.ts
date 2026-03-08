/**
 * NibService — high-level service that orchestrates PDF extraction + .nib parsing.
 *
 * Supports two parsing modes:
 * 1. Rich mode (PDFs with text layers): uses NibParser with font/position data
 * 2. Text mode (scanned PDFs / AI-extracted text): uses NibTextParser on flat strings
 *
 * Usage:
 *   const nibService = new NibService()
 *   // From flat extracted text:
 *   const nibDoc = nibService.parseExtractedText(sectionText, 'Book Title', 'Author')
 *   const word = nibDoc.pages[0].paragraphs[0].sentences[0].words[2]
 *   console.log(word.getAIContext())
 */

import { NibParser, NibTextParser, type NibParserConfig, type NibTextParserConfig } from '@/lib/nib'
import { NibDocument, type NibDocumentData } from '@/lib/nib'

export class NibService {
  private _pdfService: any | null = null
  private parser: NibParser
  private textParser: NibTextParser
  private parserConfig?: NibParserConfig

  constructor(parserConfig?: NibParserConfig, textParserConfig?: NibTextParserConfig) {
    this.parserConfig = parserConfig
    this.parser = new NibParser(parserConfig)
    this.textParser = new NibTextParser(textParserConfig)
  }

  /** Lazy-load PDFService to avoid importing pdfjs-dist (DOMMatrix) in SSR */
  private async getPdfService() {
    if (!this._pdfService) {
      const { PDFService } = await import('./pdf-service')
      this._pdfService = new PDFService()
    }
    return this._pdfService
  }

  /**
   * Parse already-extracted text (from AI/OCR) into a NibDocument.
   * This is the primary path for scanned PDFs.
   */
  parseExtractedText(
    text: string,
    title: string,
    author: string,
    pageNumber?: number,
  ): NibDocument {
    const data = this.textParser.parseText(text, title, author, pageNumber)
    return NibDocument.fromData(data)
  }

  /**
   * Parse multi-page extracted text into a NibDocument.
   */
  parseMultiPageText(
    text: string,
    title: string,
    author: string,
    startPage: number,
  ): NibDocument {
    const data = this.textParser.parseMultiPageText(text, title, author, startPage)
    return NibDocument.fromData(data)
  }

  /**
   * Parse a range of pages from a PDF blob into a NibDocument.
   * Only works for PDFs with text layers (not scanned).
   */
  async parsePages(
    blob: Blob,
    startPage: number,
    endPage: number,
    title: string,
    author: string,
  ): Promise<NibDocument> {
    const pdfService = await this.getPdfService()
    const rawPages = await pdfService.extractRichPageRange(blob, startPage, endPage)
    const data = this.parser.parseDocument(rawPages, title, author)
    return NibDocument.fromData(data)
  }

  /**
   * Parse a single page from a PDF blob into a NibDocument.
   */
  async parsePage(
    blob: Blob,
    pageNumber: number,
    title: string,
    author: string,
  ): Promise<NibDocument> {
    return this.parsePages(blob, pageNumber, pageNumber, title, author)
  }

  /**
   * Parse pages and return the raw serializable data (for storage in IndexedDB).
   */
  async parsePagesData(
    blob: Blob,
    startPage: number,
    endPage: number,
    title: string,
    author: string,
  ): Promise<NibDocumentData> {
    const pdfService = await this.getPdfService()
    const rawPages = await pdfService.extractRichPageRange(blob, startPage, endPage)
    return this.parser.parseDocument(rawPages, title, author)
  }

  /**
   * Get clean body text from a page range (headers, footers, footnotes removed).
   * This replaces the old `extractPageText` for section text — much cleaner output.
   */
  async getCleanText(
    blob: Blob,
    startPage: number,
    endPage: number,
    title: string,
    author: string,
  ): Promise<string> {
    const pdfService = await this.getPdfService()
    const rawPages = await pdfService.extractRichPageRange(blob, startPage, endPage)
    const data = this.parser.parseDocument(rawPages, title, author)
    const doc = NibDocument.fromData(data)
    return doc.fullText
  }

  /**
   * Get clean body text from already-extracted text.
   */
  getCleanTextFromExtracted(text: string, title: string, author: string): string {
    const doc = this.parseExtractedText(text, title, author)
    return doc.fullText
  }

  /**
   * Parse extracted text and return only the body paragraphs (no intro text).
   * Intro paragraphs (blockType='introduction') are stripped out.
   *
   * Problem: Extracted text for a section covers full PDF pages, but sections
   * often start mid-page. So the text may contain "intro overflow" — text from
   * the previous section/chapter intro that shares the same page. The text
   * parser tags text before the first header as 'introduction'. But if the
   * section header (e.g. "1.1 What Is a Design Pattern?") wasn't captured in
   * the extracted text, the parser sees NO header and tags EVERYTHING as
   * 'introduction', which then gets stripped — resulting in an empty page.
   *
   * Fix: When we have a sectionTitle that looks like a numbered header and
   * it's missing from the extracted text, we find the best paragraph break
   * to insert it. Text before the inserted header = intro overflow (stripped).
   * Text after = actual section body (kept).
   */
  parseExtractedTextBodyOnly(
    text: string,
    title: string,
    author: string,
    pageNumber?: number,
    sectionTitle?: string,
  ): NibDocument {
    let textToParse = text

    // If we have a numbered section title not present in the text, find the
    // best paragraph break to insert it as a synthetic header.
    if (sectionTitle && /^(\d+\.)+\d*\s/.test(sectionTitle) && !text.includes(sectionTitle)) {
      textToParse = this.injectSectionHeader(text, sectionTitle)
    }

    const data = this.textParser.parseText(textToParse, title, author, pageNumber)

    // Strip introduction paragraphs from each page
    for (const page of data.pages) {
      const bodyParagraphs = page.paragraphs.filter(p => p.blockType !== 'introduction')
      // If stripping intros leaves NO paragraphs, keep them all as a fallback
      // (better to show everything than nothing)
      if (bodyParagraphs.length > 0) {
        page.paragraphs = bodyParagraphs.map((p, i) => ({ ...p, index: i }))
      } else {
        page.paragraphs = page.paragraphs.map((p, i) => ({
          ...p, index: i, blockType: undefined,
        }))
      }
    }
    return NibDocument.fromData(data)
  }

  /**
   * Find the best paragraph break in the text to insert a synthetic section
   * header. Tries each `\n\n` position and picks the one that produces the
   * best intro/body split (most body content while having some intro stripped).
   * Falls back to prepending if no good split is found.
   */
  private injectSectionHeader(text: string, sectionTitle: string): string {
    // Find all paragraph break positions
    const breaks: number[] = []
    let idx = 0
    while ((idx = text.indexOf('\n\n', idx)) !== -1) {
      breaks.push(idx)
      idx += 2
    }

    if (breaks.length === 0) {
      // No paragraph breaks — just prepend
      return `${sectionTitle}\n\n${text}`
    }

    // Try each break position: insert header there and see which split
    // gives us body paragraphs while stripping some intro.
    // We want: some intro paragraphs stripped, and a good amount of body kept.
    let bestBreak = breaks[0]
    let bestScore = -1

    for (const bp of breaks) {
      const before = text.substring(0, bp).trim()
      const after = text.substring(bp + 2).trim()

      // Skip breaks too early (< 100 chars before) or too late (< 100 chars after)
      if (before.length < 50 || after.length < 50) continue

      // Score: prefer splits where the "after" portion is larger (more body content)
      // but there's still a meaningful "before" portion (intro overflow exists).
      // Also prefer breaks where the text before ends with sentence-ending punctuation.
      const endsCleanly = /[.!?"\u201D]\s*$/.test(before)
      const score = (endsCleanly ? 1000 : 0) + after.length

      if (score > bestScore) {
        bestScore = score
        bestBreak = bp
      }
    }

    // Insert the section title at the best break position
    const beforeHeader = text.substring(0, bestBreak)
    const afterHeader = text.substring(bestBreak + 2)
    return `${beforeHeader}\n\n${sectionTitle}\n\n${afterHeader}`
  }

  /**
   * Parse extracted text and return only the introduction paragraphs.
   * Use this for synthesized "Introduction" sections.
   */
  parseExtractedTextIntroOnly(
    text: string,
    title: string,
    author: string,
    pageNumber?: number,
  ): NibDocument {
    const data = this.textParser.parseText(text, title, author, pageNumber)
    // Keep only introduction paragraphs
    for (const page of data.pages) {
      page.paragraphs = page.paragraphs
        .filter(p => p.blockType === 'introduction')
        .map((p, i) => ({ ...p, index: i }))
    }
    return NibDocument.fromData(data)
  }

  /**
   * Rehydrate a NibDocument from stored data (e.g. from IndexedDB).
   */
  static fromStoredData(data: NibDocumentData): NibDocument {
    return NibDocument.fromData(data)
  }
}
