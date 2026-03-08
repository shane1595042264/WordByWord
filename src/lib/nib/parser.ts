/**
 * NibParser — converts raw PDF text content into structured .nib documents.
 *
 * Handles:
 *  • Header detection   (top-of-page, larger/bold fonts, short lines matching patterns)
 *  • Footer detection   (bottom-of-page, page numbers, running titles)
 *  • Footnote detection (small font, bottom region, numbered/symbol markers)
 *  • Paragraph splitting (vertical gaps between text blocks)
 *  • Sentence splitting  (period/question/exclamation + space + capital letter)
 *  • Word tokenization   (whitespace splitting with punctuation handling)
 *  • Hyphenation repair  (re-joining words split across line breaks)
 */

import type {
  NibDocumentData,
  NibPageData,
  NibParagraphData,
  NibSentenceData,
  NibWordData,
  NibHeaderData,
  NibFooterData,
  NibFootnoteData,
} from './models'

// ─── Types for raw PDF text items (from pdfjs textContent.items) ─────────────

export interface RawTextItem {
  /** The text string */
  str: string
  /** Transformation matrix [scaleX, skewX, skewY, scaleY, translateX, translateY] */
  transform: number[]
  /** Width of the text item in PDF units */
  width: number
  /** Height of the text item (approximates font size) */
  height: number
  /** Font identifier */
  fontName: string
  /** Whether pdfjs detected this as ending a line */
  hasEOL: boolean
}

export interface RawPageData {
  pageNumber: number
  items: RawTextItem[]
  /** Page height in PDF units (for Y coordinate normalization) */
  pageHeight: number
  /** Page width in PDF units */
  pageWidth: number
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface NibParserConfig {
  /**
   * Vertical gap (as fraction of median line height) that separates paragraphs.
   * Default: 1.5 — a gap 1.5× the normal line spacing starts a new paragraph.
   */
  paragraphGapFactor?: number

  /**
   * Fraction of page height from top considered the header region.
   * Default: 0.08 (top 8% of page)
   */
  headerRegionFraction?: number

  /**
   * Fraction of page height from bottom considered the footer region.
   * Default: 0.08 (bottom 8% of page)
   */
  footerRegionFraction?: number

  /**
   * Minimum font size ratio (relative to median body font) to classify as a heading.
   * Default: 1.15 — text 15% larger than body text is likely a heading.
   */
  headingFontSizeRatio?: number

  /**
   * Maximum font size ratio (relative to median body font) to classify as footnote text.
   * Default: 0.85 — text 15% smaller than body text may be a footnote.
   */
  footnoteFontSizeRatio?: number

  /**
   * Regex patterns for header lines (e.g., "CHAPTER 1", "Part II", page-number-only lines).
   * These are tested against the joined text of short top-region lines.
   */
  headerPatterns?: RegExp[]

  /**
   * Regex patterns for footer lines (e.g., standalone page numbers).
   */
  footerPatterns?: RegExp[]
}

const DEFAULT_CONFIG: Required<NibParserConfig> = {
  paragraphGapFactor: 1.5,
  headerRegionFraction: 0.08,
  footerRegionFraction: 0.08,
  headingFontSizeRatio: 1.15,
  footnoteFontSizeRatio: 0.85,
  headerPatterns: [
    /^(chapter|part|section)\s+[\divxlc]+/i,
    /^\d+\s+(chapter|part|section)/i,
    /^[IVXLC]+\.\s/,                           // Roman numeral headings
    /^(\d+\.)+\d*\s+\S/,                        // Numbered headings like "1.1 Title"
    /^\d+\s+[A-Z][A-Z\s]+$/,                    // "2  INTRODUCTION  CHAPTER 1"
  ],
  footerPatterns: [
    /^\d+$/,                                     // Standalone page number
    /^[-–—]\s*\d+\s*[-–—]$/,                     // Dashed page number
    /^page\s+\d+/i,
  ],
}

// ─── Internal helpers ────────────────────────────────────────────────────────

interface TextLine {
  items: RawTextItem[]
  /** Y position (top of line, normalized so 0 = top of page) */
  y: number
  /** Average font height of items on this line */
  avgHeight: number
  /** Joined text */
  text: string
}

/**
 * Group raw text items into lines based on Y-position proximity.
 * Items within ±half a line height of each other are grouped.
 */
function groupIntoLines(items: RawTextItem[], pageHeight: number): TextLine[] {
  if (items.length === 0) return []

  // PDF Y coordinates: 0 = bottom of page. We flip to 0 = top.
  const withY = items.map(item => ({
    item,
    y: pageHeight - item.transform[5], // flip Y
  }))

  // Sort by Y (top to bottom), then X (left to right)
  withY.sort((a, b) => a.y - b.y || a.item.transform[4] - b.item.transform[4])

  const lines: TextLine[] = []
  let currentLineItems: RawTextItem[] = [withY[0].item]
  let currentY = withY[0].y

  for (let i = 1; i < withY.length; i++) {
    const { item, y } = withY[i]
    const lineHeight = Math.max(item.height, currentLineItems[0]?.height ?? 10)
    // If this item is on roughly the same Y level, add to current line
    if (Math.abs(y - currentY) < lineHeight * 0.5) {
      currentLineItems.push(item)
    } else {
      // Emit the current line
      lines.push(buildLine(currentLineItems, currentY))
      currentLineItems = [item]
      currentY = y
    }
  }
  if (currentLineItems.length > 0) {
    lines.push(buildLine(currentLineItems, currentY))
  }

  return lines
}

function buildLine(items: RawTextItem[], y: number): TextLine {
  // Sort items left-to-right by X position
  items.sort((a, b) => a.transform[4] - b.transform[4])
  const avgHeight = items.reduce((sum, it) => sum + it.height, 0) / items.length
  const text = items.map(it => it.str).join(' ').trim()
  return { items, y, avgHeight, text }
}

/**
 * Compute the median of a number array.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ─── Sentence splitting ─────────────────────────────────────────────────────

/**
 * Split a paragraph text into sentences.
 * Handles abbreviations (Mr., Dr., etc.) and decimal numbers.
 */
function splitSentences(text: string): string[] {
  // Sentence-ending punctuation followed by space(s) and a capital letter or end of string
  // Negative lookbehind for common abbreviations
  const abbrevs = '(?<!Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|Inc|Ltd|Corp|St|Ave|approx|ca|cf|e\\.g|i\\.e|al)'
  const regex = new RegExp(`${abbrevs}([.!?])\\s+(?=[A-Z""\u201C])`, 'g')

  const sentences: string[] = []
  let lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const end = match.index + match[1].length
    sentences.push(text.slice(lastIndex, end).trim())
    lastIndex = end + match[0].length - match[1].length
  }

  // Remaining text is the last sentence
  const remaining = text.slice(lastIndex).trim()
  if (remaining) sentences.push(remaining)

  return sentences.length > 0 ? sentences : [text]
}

/**
 * Tokenize a sentence into words.
 * Keeps punctuation attached to words (e.g. "hello," → "hello,").
 */
function tokenizeWords(sentence: string): string[] {
  return sentence.split(/\s+/).filter(w => w.length > 0)
}

// ─── Main Parser ─────────────────────────────────────────────────────────────

export class NibParser {
  private config: Required<NibParserConfig>

  constructor(config?: NibParserConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Parse a full document (multiple pages of raw PDF data) into a NibDocumentData.
   */
  parseDocument(
    pages: RawPageData[],
    title: string,
    author: string,
  ): NibDocumentData {
    return {
      version: 1,
      sourceTitle: title,
      sourceAuthor: author,
      pages: pages.map(p => this.parsePage(p)),
      createdAt: Date.now(),
    }
  }

  /**
   * Parse a single page of raw text items.
   */
  parsePage(raw: RawPageData): NibPageData {
    const lines = groupIntoLines(raw.items, raw.pageHeight)
    if (lines.length === 0) {
      return {
        pageNumber: raw.pageNumber,
        header: null,
        footer: null,
        footnotes: [],
        paragraphs: [],
        figures: [],
        listItems: [],
      }
    }

    // ── Compute page-level statistics ──
    const allHeights = lines.map(l => l.avgHeight)
    const medianHeight = median(allHeights)
    const headerCutoff = raw.pageHeight * this.config.headerRegionFraction
    const footerCutoff = raw.pageHeight * (1 - this.config.footerRegionFraction)

    // ── Detect header ──
    const header = this.detectHeader(lines, medianHeight, headerCutoff)

    // ── Detect footer ──
    const footer = this.detectFooter(lines, medianHeight, footerCutoff, raw.pageHeight)

    // ── Detect footnotes ──
    const footnotes = this.detectFootnotes(lines, medianHeight, footerCutoff, raw.pageHeight)

    // ── Determine which lines are body text ──
    const headerLines = new Set<TextLine>()
    const footerLines = new Set<TextLine>()
    const footnoteLines = new Set<TextLine>()

    if (header) {
      for (const line of lines) {
        if (line.y < headerCutoff && this.isHeaderLine(line, medianHeight)) {
          headerLines.add(line)
        }
      }
    }
    if (footer) {
      for (const line of lines) {
        if (line.y > footerCutoff && this.isFooterLine(line, medianHeight)) {
          footerLines.add(line)
        }
      }
    }
    if (footnotes.length > 0) {
      for (const line of lines) {
        if (line.y > footerCutoff && line.avgHeight < medianHeight * this.config.footnoteFontSizeRatio) {
          footnoteLines.add(line)
        }
      }
    }

    const bodyLines = lines.filter(
      l => !headerLines.has(l) && !footerLines.has(l) && !footnoteLines.has(l)
    )

    // ── Detect additional headings within the body ──
    // Lines that are significantly larger than body text or match heading patterns
    const headingDetected = this.detectInlineHeadings(bodyLines, medianHeight)

    // Separate actual body content from detected inline headings
    const finalHeader = this.mergeHeaders(header, headingDetected, lines, headerCutoff, medianHeight)
    const contentLines = bodyLines.filter(l => !headingDetected.includes(l))

    // ── Split body lines into paragraphs ──
    const paragraphs = this.splitIntoParagraphs(contentLines, medianHeight)

    return {
      pageNumber: raw.pageNumber,
      header: finalHeader,
      footer,
      footnotes,
      paragraphs,
      figures: [],
      listItems: [],
    }
  }

  // ─── Header Detection ──────────────────────────────────────────────────────

  private detectHeader(
    lines: TextLine[],
    medianHeight: number,
    headerCutoff: number,
  ): NibHeaderData | null {
    // Look at lines in the header region (top of page)
    const topLines = lines.filter(l => l.y < headerCutoff)
    if (topLines.length === 0) return null

    const headerTexts: string[] = []
    let maxLevel = 2 // default to section-level

    for (const line of topLines) {
      if (this.isHeaderLine(line, medianHeight)) {
        headerTexts.push(line.text)
        // Larger font → higher-level heading
        if (line.avgHeight > medianHeight * 1.3) maxLevel = 1
      }
    }

    if (headerTexts.length === 0) return null

    return {
      text: headerTexts.join(' ').trim(),
      level: maxLevel,
    }
  }

  private isHeaderLine(line: TextLine, medianHeight: number): boolean {
    // Check if the line matches a header pattern
    for (const pattern of this.config.headerPatterns) {
      if (pattern.test(line.text)) return true
    }
    // Check if font size is significantly larger
    if (line.avgHeight > medianHeight * this.config.headingFontSizeRatio) {
      // But only if it's reasonably short (headers aren't full paragraphs)
      if (line.text.length < 100) return true
    }
    return false
  }

  /**
   * Detect headings that appear within the body (not just top of page).
   * E.g., "1.1  What Is a Design Pattern?" appearing mid-page.
   */
  private detectInlineHeadings(
    bodyLines: TextLine[],
    medianHeight: number,
  ): TextLine[] {
    const headings: TextLine[] = []
    for (const line of bodyLines) {
      // Must be a short line with larger font
      if (line.text.length > 120) continue
      if (line.avgHeight > medianHeight * this.config.headingFontSizeRatio) {
        headings.push(line)
        continue
      }
      // Check heading patterns
      for (const pattern of this.config.headerPatterns) {
        if (pattern.test(line.text)) {
          headings.push(line)
          break
        }
      }
    }
    return headings
  }

  /**
   * Merge the page-top header with any inline headings detected in the body.
   */
  private mergeHeaders(
    topHeader: NibHeaderData | null,
    inlineHeadings: TextLine[],
    _lines: TextLine[],
    _headerCutoff: number,
    _medianHeight: number,
  ): NibHeaderData | null {
    if (!topHeader && inlineHeadings.length === 0) return null

    const parts: string[] = []
    if (topHeader) parts.push(topHeader.text)
    for (const h of inlineHeadings) parts.push(h.text)

    return {
      text: parts.join(' | '),
      level: topHeader?.level ?? 2,
    }
  }

  // ─── Footer Detection ──────────────────────────────────────────────────────

  private detectFooter(
    lines: TextLine[],
    medianHeight: number,
    footerCutoff: number,
    _pageHeight: number,
  ): NibFooterData | null {
    const bottomLines = lines.filter(l => l.y > footerCutoff)
    if (bottomLines.length === 0) return null

    const footerTexts: string[] = []
    for (const line of bottomLines) {
      if (this.isFooterLine(line, medianHeight)) {
        footerTexts.push(line.text)
      }
    }

    if (footerTexts.length === 0) return null

    return { text: footerTexts.join(' ').trim() }
  }

  private isFooterLine(line: TextLine, medianHeight: number): boolean {
    for (const pattern of this.config.footerPatterns) {
      if (pattern.test(line.text)) return true
    }
    // Small text at bottom that's very short (page number, running title)
    if (line.text.length < 50 && line.avgHeight <= medianHeight) return true
    return false
  }

  // ─── Footnote Detection ────────────────────────────────────────────────────

  private detectFootnotes(
    lines: TextLine[],
    medianHeight: number,
    footerCutoff: number,
    _pageHeight: number,
  ): NibFootnoteData[] {
    // Footnotes: smaller font, bottom region, often starting with a number/symbol
    const candidates = lines.filter(l =>
      l.y > footerCutoff * 0.85 && // a bit above the strict footer region
      l.avgHeight < medianHeight * this.config.footnoteFontSizeRatio
    )

    const footnotes: NibFootnoteData[] = []
    const footnotePattern = /^(\d+|[*†‡§¶]|\(\d+\))\s*(.+)/

    for (const line of candidates) {
      const match = line.text.match(footnotePattern)
      if (match) {
        footnotes.push({
          marker: match[1],
          text: match[2].trim(),
        })
      }
    }

    return footnotes
  }

  // ─── Paragraph Splitting ───────────────────────────────────────────────────

  private splitIntoParagraphs(
    lines: TextLine[],
    medianHeight: number,
  ): NibParagraphData[] {
    if (lines.length === 0) return []

    const paragraphs: NibParagraphData[] = []
    let currentParagraphLines: TextLine[] = [lines[0]]

    // Compute median line spacing
    const lineGaps: number[] = []
    for (let i = 1; i < lines.length; i++) {
      lineGaps.push(lines[i].y - lines[i - 1].y)
    }
    const medianGap = lineGaps.length > 0 ? median(lineGaps) : medianHeight * 1.5
    const paragraphThreshold = medianGap * this.config.paragraphGapFactor

    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i].y - lines[i - 1].y

      if (gap > paragraphThreshold) {
        // Large gap → new paragraph
        paragraphs.push(this.buildParagraph(currentParagraphLines, paragraphs.length))
        currentParagraphLines = [lines[i]]
      } else {
        currentParagraphLines.push(lines[i])
      }
    }

    // Don't forget the last paragraph
    if (currentParagraphLines.length > 0) {
      paragraphs.push(this.buildParagraph(currentParagraphLines, paragraphs.length))
    }

    return paragraphs
  }

  private buildParagraph(lines: TextLine[], index: number): NibParagraphData {
    // Join line texts, handling hyphenation
    let fullText = ''
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i].text
      if (i > 0) {
        // Check if previous line ended with a hyphen (hyphenated word)
        if (fullText.endsWith('-')) {
          // Remove hyphen and join directly (re-join the word)
          fullText = fullText.slice(0, -1)
          // Mark that a hyphenation join happened (we'll track this at word level)
        } else {
          fullText += ' '
        }
      }
      fullText += lineText
    }

    fullText = fullText.trim()

    // Split into sentences
    const sentenceTexts = splitSentences(fullText)
    const sentences: NibSentenceData[] = sentenceTexts.map((sentText, sIdx) => {
      const wordTexts = tokenizeWords(sentText)
      const words: NibWordData[] = wordTexts.map((w, wIdx) => ({
        text: w,
        index: wIdx,
      }))
      return { words, index: sIdx }
    })

    return { sentences, index }
  }
}
