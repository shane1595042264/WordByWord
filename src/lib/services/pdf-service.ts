import * as pdfjs from 'pdfjs-dist'
import type { RawTextItem, RawPageData } from '@/lib/nib'

if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
}

export interface PDFMetadata {
  title: string
  author: string
  totalPages: number
}

export interface PDFOutlineItem {
  title: string
  pageNumber: number | null
  children: PDFOutlineItem[]
}

export class PDFService {
  async extractMetadata(blob: Blob): Promise<PDFMetadata> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const metadata = await doc.getMetadata()
      const info = metadata.info as Record<string, any>
      return {
        title: info?.Title || 'Untitled',
        author: info?.Author || 'Unknown',
        totalPages: doc.numPages,
      }
    } finally {
      doc.destroy()
    }
  }

  async extractOutline(blob: Blob): Promise<PDFOutlineItem[] | null> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const outline = await doc.getOutline()
      if (!outline || outline.length === 0) {
        return null
      }
      // Resolve all page numbers from destinations
      const items = await this.mapOutlineItems(outline, doc)
      return items
    } finally {
      doc.destroy()
    }
  }

  async renderPageToImage(blob: Blob, pageNumber: number, scale: number = 2): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')!
      await page.render({ canvasContext: ctx, viewport, canvas } as unknown as import('pdfjs-dist/types/src/display/api').RenderParameters).promise
      return canvas.toDataURL('image/png')
    } finally {
      doc.destroy()
    }
  }

  async extractPageText(blob: Blob, pageNumber: number): Promise<string> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const textContent = await page.getTextContent()
      return textContent.items.map((item: any) => item.str).join(' ')
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract rich text data from a page, including position and font info.
   * This powers the .nib parser for header/footnote detection.
   */
  async extractRichPageData(blob: Blob, pageNumber: number): Promise<RawPageData> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      const textContent = await page.getTextContent()

      const items: RawTextItem[] = textContent.items
        .filter((item: any) => item.str && item.str.trim().length > 0)
        .map((item: any) => ({
          str: item.str,
          transform: item.transform,
          width: item.width,
          height: item.height,
          fontName: item.fontName ?? '',
          hasEOL: item.hasEOL ?? false,
        }))

      return {
        pageNumber,
        items,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
      }
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract rich text data for a range of pages at once (more efficient).
   */
  async extractRichPageRange(blob: Blob, startPage: number, endPage: number): Promise<RawPageData[]> {
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const results: RawPageData[] = []
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        const page = await doc.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()

        // Render the page off-screen to force PDF.js to resolve font objects.
        // Only then can we access commonObjs.get(fontId).name for the real font name.
        const offscreen = document.createElement('canvas')
        offscreen.width = viewport.width
        offscreen.height = viewport.height
        const offCtx = offscreen.getContext('2d')!
        await page.render({ canvasContext: offCtx, viewport, canvas: offscreen } as unknown as import('pdfjs-dist/types/src/display/api').RenderParameters).promise

        // Build a map from font ID → actual font name (e.g. "TimesNewRomanPS-BoldMT")
        const fontNameMap = new Map<string, string>()
        const seenFontIds = new Set<string>()
        for (const item of textContent.items as any[]) {
          if (item.fontName) seenFontIds.add(item.fontName)
        }
        for (const fontId of seenFontIds) {
          try {
            const fontObj = page.commonObjs.get(fontId)
            if (fontObj?.name) {
              fontNameMap.set(fontId, fontObj.name)
            }
          } catch {
            // Font not resolved — fall back to opaque ID
          }
        }

        const items: RawTextItem[] = textContent.items
          .filter((item: any) => item.str && item.str.trim().length > 0)
          .map((item: any) => ({
            str: item.str,
            transform: item.transform,
            width: item.width,
            height: item.height,
            fontName: fontNameMap.get(item.fontName) ?? item.fontName ?? '',
            hasEOL: item.hasEOL ?? false,
          }))

        results.push({
          pageNumber: pageNum,
          items,
          pageHeight: viewport.height,
          pageWidth: viewport.width,
        })
      }
      return results
    } finally {
      doc.destroy()
    }
  }

  private async mapOutlineItems(
    items: any[],
    doc: pdfjs.PDFDocumentProxy,
  ): Promise<PDFOutlineItem[]> {
    const result: PDFOutlineItem[] = []
    for (const item of items) {
      const pageNumber = await this.resolveDestPage(item.dest, doc)
      const children = item.items?.length
        ? await this.mapOutlineItems(item.items, doc)
        : []
      result.push({ title: item.title, pageNumber, children })
    }
    return result
  }

  private async resolveDestPage(
    dest: any,
    doc: pdfjs.PDFDocumentProxy,
  ): Promise<number | null> {
    try {
      // dest can be a string (named dest) or an array (explicit dest)
      let resolved = dest
      if (typeof dest === 'string') {
        resolved = await doc.getDestination(dest)
      }
      if (!resolved || !Array.isArray(resolved)) return null
      // resolved[0] is a page ref object
      const pageRef = resolved[0]
      const pageIndex = await doc.getPageIndex(pageRef)
      return pageIndex + 1 // PDF.js pages are 0-indexed, we use 1-indexed
    } catch {
      return null
    }
  }
}
