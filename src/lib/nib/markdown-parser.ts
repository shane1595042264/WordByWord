/**
 * NibMarkdownParser — Converts Mathpix-style Markdown (with LaTeX) to NibDocumentData.
 *
 * Handles:
 *   - Block classification: body, blockquote, list-item, latex-display
 *   - Sentence splitting with abbreviation awareness
 *   - Inline LaTeX ($...$) tokenization via tokenizeLatex()
 *   - Display math ($$...$$) as dedicated latex-display paragraphs
 */

import type {
  NibDocumentData,
  NibPageData,
  NibParagraphData,
  NibSentenceData,
  NibWordData,
  NibBlockType,
} from './models'
import { tokenizeLatex } from './latex-tokenizer'

/** Abbreviation patterns that should NOT trigger sentence breaks */
const ABBREVIATION_RE =
  /(?:^|\s)(?:e\.g|i\.e|Dr|Mr|Mrs|Ms|vs|etc|Prof|Jr|Sr|St|Vol|[A-Z])\.$/

export class NibMarkdownParser {
  parse(markdown: string, title: string, author: string): NibDocumentData {
    const blocks = this.splitBlocks(markdown)
    const paragraphs: NibParagraphData[] = []

    for (const block of blocks) {
      // Special case: block contains image + caption on separate lines
      // e.g. "![](url)\nFigure 0.1. Caption text..."
      if (block.startsWith('![') && block.includes('\n')) {
        const lines = block.split('\n')
        const imgLine = lines[0]
        const captionLines = lines.slice(1).join('\n').trim()

        // Image paragraph
        const imgPara = this.buildParagraph(imgLine, 'figure-caption', paragraphs.length)
        paragraphs.push(imgPara)

        // Caption paragraph (if any)
        if (captionLines) {
          const { blockType: capType, content: capContent } = this.classifyBlock(captionLines)
          const capPara = this.buildParagraph(capContent, capType, paragraphs.length)
          paragraphs.push(capPara)
        }
        continue
      }

      const { blockType, content } = this.classifyBlock(block)
      const paragraph = this.buildParagraph(content, blockType, paragraphs.length)
      paragraphs.push(paragraph)
    }

    const page: NibPageData = {
      pageNumber: 1,
      header: null,
      footer: null,
      footnotes: [],
      paragraphs,
      figures: [],
      listItems: [],
    }

    return {
      version: 1,
      sourceTitle: title,
      sourceAuthor: author,
      pages: [page],
      createdAt: Date.now(),
    }
  }

  /** Split markdown on double newlines into blocks, filtering empties */
  private splitBlocks(markdown: string): string[] {
    return markdown
      .split(/\n\n+/)
      .map(b => b.trim())
      .filter(b => b.length > 0)
  }

  /** Classify a block by its leading characters */
  private classifyBlock(block: string): { blockType: NibBlockType; content: string } {
    // Display math: starts and ends with $$
    if (block.startsWith('$$') && block.endsWith('$$')) {
      return { blockType: 'latex-display', content: block.slice(2, -2).trim() }
    }

    // Code block: starts and ends with ```
    if (block.startsWith('```') && block.endsWith('```')) {
      const content = block.slice(3, -3).replace(/^\w*\n/, '').trim()  // strip language hint + backticks
      return { blockType: 'code-block' as any, content }
    }

    // Markdown table: contains | --- | pattern (separator row)
    if (/\|\s*-{2,}/.test(block) || /\|\s*:{0,1}-{2,}:{0,1}\s*\|/.test(block)) {
      return { blockType: 'table' as any, content: block }
    }

    // Markdown heading: ## Title → strip hashes, render as subheading (bold heading text)
    if (/^#{1,6}\s/.test(block)) {
      const content = block.replace(/^#{1,6}\s+/, '').trim()
      return { blockType: 'subheading', content }
    }

    // Blockquote: starts with >
    if (block.startsWith('>')) {
      const content = block.replace(/^>\s?/gm, '').trim()
      return { blockType: 'blockquote', content }
    }

    // Image/figure: ![alt](url) or ![](url)
    if (/^!\[/.test(block)) {
      return { blockType: 'figure-caption', content: block }
    }

    // List item: starts with - or * followed by space
    if (/^[-*]\s/.test(block)) {
      const content = block.replace(/^[-*]\s/, '').trim()
      return { blockType: 'list-item', content }
    }

    // Figure caption: starts with "Figure X.X" or "Table X.X" pattern
    if (/^(?:Figure|Table)\s+\d/i.test(block)) {
      return { blockType: 'figure-caption', content: block }
    }

    return { blockType: 'body', content: block }
  }

  /** Build a NibParagraphData from classified content */
  private buildParagraph(
    content: string,
    blockType: NibBlockType,
    index: number,
  ): NibParagraphData {
    let sentences: NibSentenceData[]

    if (blockType === 'latex-display') {
      sentences = [this.buildDisplayMathSentence(content, 0)]
    } else if ((blockType as string) === 'table' || (blockType as string) === 'code-block') {
      // Store raw content as a single NibWord — vim treats it as one selectable block
      // The viewer renders the actual HTML, but the NibWord exists for cursor targeting
      const blockLabel = (blockType as string) === 'table' ? '[Table]' : '[Code]'
      const word: NibWordData = {
        text: blockLabel,
        index: 0,
        // Store raw content in latexSource for AI context (AI can read raw markdown)
        latexSource: content,
        isDecorative: false,
      }
      sentences = [{ words: [word], index: 0 }]
    } else if (blockType === 'figure-caption' && content.startsWith('![')) {
      sentences = [this.buildImageSentence(content, 0)]
    } else {
      const sentenceTexts = this.splitSentences(content)
      sentences = sentenceTexts.map((text, i) => this.buildSentence(text, i))
    }

    return { sentences, index, blockType }
  }

  /** Build an image sentence from ![alt](url) markdown */
  private buildImageSentence(markdown: string, sentenceIndex: number): NibSentenceData {
    const match = markdown.match(/!\[(.*?)\]\((.*?)\)/)
    if (!match) {
      // Fallback: treat as regular text
      return this.buildSentence(markdown, sentenceIndex)
    }
    const alt = match[1] || 'Figure'
    const url = match[2]
    const word: NibWordData = {
      text: alt || '[Figure]',
      index: 0,
      imageUrl: url,
      latexSource: markdown, // Full markdown for AI context
    }
    return { words: [word], index: sentenceIndex }
  }

  /** Build a single display-math sentence: all tokens from tokenizeLatex, all isLatex */
  private buildDisplayMathSentence(latex: string, sentenceIndex: number): NibSentenceData {
    const tokens = tokenizeLatex(latex)
    const words: NibWordData[] = tokens.map((token, i) => ({
      text: token.text,
      index: i,
      isLatex: true,
      latexSource: latex,
      isDecorative: token.isDecorative,
    }))

    return { words, index: sentenceIndex, hasLatex: true }
  }

  /**
   * Split text into sentences.
   * Splits on `. `, `? `, `! ` but NOT after common abbreviations
   * or single uppercase letters (e.g. "A.").
   */
  private splitSentences(text: string): string[] {
    const sentences: string[] = []
    let current = ''

    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      current += ch

      // Check for sentence-ending punctuation followed by a space
      if ((ch === '.' || ch === '?' || ch === '!') && i + 1 < text.length && text[i + 1] === ' ') {
        // Check if this is an abbreviation
        if (ch === '.' && ABBREVIATION_RE.test(current)) {
          continue
        }
        sentences.push(current.trim())
        current = ''
        // Skip the space after the punctuation
        i++
      }
    }

    if (current.trim().length > 0) {
      sentences.push(current.trim())
    }

    return sentences
  }

  /** Build a NibSentenceData from text that may contain inline LaTeX ($...$) */
  private buildSentence(text: string, sentenceIndex: number): NibSentenceData {
    const words: NibWordData[] = []
    let hasLatex = false

    // Split text into segments of plain text and inline LaTeX
    const segments = this.splitInlineLatex(text)

    for (const segment of segments) {
      if (segment.isLatex) {
        hasLatex = true
        const tokens = tokenizeLatex(segment.text)
        for (const token of tokens) {
          words.push({
            text: token.text,
            index: words.length,
            isLatex: true,
            latexSource: segment.text,
            isDecorative: token.isDecorative,
          })
        }
      } else {
        // Plain text: split on whitespace, detect **bold** and *italic*
        const plainWords = segment.text.split(/\s+/).filter(w => w.length > 0)
        for (let w of plainWords) {
          let bold = false
          let italic = false
          // **bold** or __bold__
          if ((w.startsWith('**') && w.endsWith('**')) || (w.startsWith('__') && w.endsWith('__'))) {
            bold = true
            w = w.slice(2, -2)
          }
          // *italic* or _italic_ (but not ** or __)
          else if ((w.startsWith('*') && w.endsWith('*') && !w.startsWith('**')) ||
                   (w.startsWith('_') && w.endsWith('_') && !w.startsWith('__'))) {
            italic = true
            w = w.slice(1, -1)
          }
          // ***bold italic***
          else if (w.startsWith('***') && w.endsWith('***')) {
            bold = true
            italic = true
            w = w.slice(3, -3)
          }
          if (w.length > 0) {
            words.push({
              text: w,
              index: words.length,
              bold: bold || undefined,
              italic: italic || undefined,
            })
          }
        }
      }
    }

    return { words, index: sentenceIndex, hasLatex: hasLatex || undefined }
  }

  /**
   * Split text into alternating plain-text and inline-LaTeX segments.
   * Inline LaTeX is delimited by single $ (but NOT $$).
   */
  private splitInlineLatex(text: string): Array<{ text: string; isLatex: boolean }> {
    const segments: Array<{ text: string; isLatex: boolean }> = []
    let i = 0
    let plainStart = 0

    while (i < text.length) {
      // Check for single $ that's not $$
      if (text[i] === '$' && (i + 1 >= text.length || text[i + 1] !== '$')) {
        // Flush preceding plain text
        if (i > plainStart) {
          segments.push({ text: text.slice(plainStart, i), isLatex: false })
        }

        // Find closing $
        const close = text.indexOf('$', i + 1)
        if (close === -1) {
          // No closing $ — treat as plain text
          plainStart = i
          i++
          continue
        }

        // Extract LaTeX content (without delimiters)
        segments.push({ text: text.slice(i + 1, close), isLatex: true })
        i = close + 1
        plainStart = i
      } else {
        i++
      }
    }

    // Flush remaining plain text
    if (plainStart < text.length) {
      segments.push({ text: text.slice(plainStart), isLatex: false })
    }

    return segments
  }
}
