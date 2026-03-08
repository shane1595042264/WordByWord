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
   * Use this for sections like "1.1 What Is a Design Pattern?" that may have
   * preceding intro text from the chapter start on the same pages.
   */
  parseExtractedTextBodyOnly(
    text: string,
    title: string,
    author: string,
    pageNumber?: number,
  ): NibDocument {
    const data = this.textParser.parseText(text, title, author, pageNumber)
    // Strip introduction paragraphs from each page
    for (const page of data.pages) {
      page.paragraphs = page.paragraphs
        .filter(p => p.blockType !== 'introduction')
        .map((p, i) => ({ ...p, index: i }))
    }
    return NibDocument.fromData(data)
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
