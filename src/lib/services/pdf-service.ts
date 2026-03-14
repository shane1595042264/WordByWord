import * as pdfjs from 'pdfjs-dist'
import type { RawTextItem, RawPageData, RawImageRegion } from '@/lib/nib'

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
  private onDebugLog?: (message: string) => void;

  constructor(onDebugLog?: (message: string) => void) {
    this.onDebugLog = onDebugLog;
  }

  async extractMetadata(blob: Blob): Promise<PDFMetadata> {
    this.onDebugLog?.("Starting PDF metadata extraction...");
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const metadata = await doc.getMetadata()
      const info = metadata.info as Record<string, any>
      const result = {
        title: info?.Title || 'Untitled',
        author: info?.Author || 'Unknown',
        totalPages: doc.numPages,
      };
      this.onDebugLog?.(`Extracted metadata: Title="${result.title}", Author="${result.author}", TotalPages=${result.totalPages}`);
      return result;
    } finally {
      doc.destroy()
      this.onDebugLog?.("Finished PDF metadata extraction.");
    }
  }

  async extractOutline(blob: Blob): Promise<PDFOutlineItem[] | null> {
    this.onDebugLog?.("Starting PDF outline extraction...");
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const outline = await doc.getOutline()
      if (!outline || outline.length === 0) {
        this.onDebugLog?.("No PDF outline found.");
        return null
      }
      this.onDebugLog?.(`Found ${outline.length} top-level outline items.`);
      const items = await this.mapOutlineItems(outline, doc)
      this.onDebugLog?.("Finished PDF outline extraction.");
      return items
    } finally {
      doc.destroy()
    }
  }

  async renderPageToImage(blob: Blob, pageNumber: number, scale: number = 2): Promise<string> {
    this.onDebugLog?.(`Rendering page ${pageNumber} to image (scale: ${scale})...`);
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
      const result = canvas.toDataURL('image/png');
      this.onDebugLog?.(`Successfully rendered page ${pageNumber} to image.`);
      return result;
    } finally {
      doc.destroy()
    }
  }

  async extractPageText(blob: Blob, pageNumber: number): Promise<string> {
    this.onDebugLog?.(`Extracting raw text from page ${pageNumber}...`);
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ');
      this.onDebugLog?.(`Extracted ${textContent.items.length} text items from page ${pageNumber}.`);
      return text;
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract rich text data from a page, including position and font info.
   * This powers the .nib parser for header/footnote detection.
   */
  async extractRichPageData(blob: Blob, pageNumber: number): Promise<RawPageData> {
    this.onDebugLog?.(`Extracting rich data from page ${pageNumber}...`);
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
      this.onDebugLog?.(`Page ${pageNumber}: Extracted ${items.length} text items.`);

      const result = {
        pageNumber,
        items,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
      };
      this.onDebugLog?.(`Finished rich data extraction for page ${pageNumber}.`);
      return result;
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract rich text data for a range of pages at once (more efficient).
   */
  async extractRichPageRange(blob: Blob, startPage: number, endPage: number): Promise<RawPageData[]> {
    this.onDebugLog?.(`Starting rich data extraction for pages ${startPage}-${endPage}...`);
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const results: RawPageData[] = []
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        this.onDebugLog?.(`Processing page ${pageNum} for rich data...`);
        const page = await doc.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1 })
        const textContent = await page.getTextContent()

        // Render the page off-screen at 2x scale for:
        // 1. Resolving font objects (so we can read real font names)
        // 2. Extracting figure images at good quality
        const imageRenderScale = 2
        const imageViewport = page.getViewport({ scale: imageRenderScale })
        const offscreen = document.createElement('canvas')
        offscreen.width = imageViewport.width
        offscreen.height = imageViewport.height
        const offCtx = offscreen.getContext('2d')!
        await page.render({ canvasContext: offCtx, viewport: imageViewport, canvas: offscreen } as unknown as import('pdfjs-dist/types/src/display/api').RenderParameters).promise

        // Extract figure images from this page
        let images: RawImageRegion[] = [];
        try {
          images = await this.extractPageImages(page, viewport, offscreen, imageRenderScale);
          this.onDebugLog?.(`Page ${pageNum}: Detected ${images.length} image regions.`);
        } catch (e) {
          this.onDebugLog?.(`Page ${pageNum}: Error extracting images: ${e instanceof Error ? e.message : String(e)}`);
        }


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
            this.onDebugLog?.(`Page ${pageNum}: Could not resolve font name for ID: ${fontId}`);
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
        this.onDebugLog?.(`Page ${pageNum}: Extracted ${items.length} text items.`);

        results.push({
          pageNumber: pageNum,
          items,
          pageHeight: viewport.height,
          pageWidth: viewport.width,
          images,
        })
        this.onDebugLog?.(`Finished rich data processing for page ${pageNum}.`);
      }
      this.onDebugLog?.(`Finished rich data extraction for pages ${startPage}-${endPage}.`);
      return results
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract meaningful image regions from a PDF page using getOperatorList.
   * Scans paint operations to find image bounding boxes, filters out background
   * images, and crops them from the rendered canvas.
   */
  private async extractPageImages(
    page: any,
    viewport: any,
    renderedCanvas: HTMLCanvasElement,
    renderScale: number,
  ): Promise<RawImageRegion[]> {
    try {
      const ops = await page.getOperatorList()
      const regions = this.collectImageRegions(ops, viewport)
      const meaningful = regions.filter(r =>
        this.isMeaningfulImageRegion(r, viewport.width, viewport.height)
      )
      const deduped = this.dedupeImageRegions(meaningful)
      this.onDebugLog?.(`  - Found ${regions.length} raw image regions, ${meaningful.length} meaningful, ${deduped.length} deduped.`);
      return deduped.map(region => ({
        ...region,
        imageSrc: this.cropImageRegion(renderedCanvas, region, renderScale, viewport.width),
      })).filter(r => r.imageSrc)
    } catch (e) {
      this.onDebugLog?.(`  - Error in extractPageImages: ${e instanceof Error ? e.message : String(e)}`);
      return []
    }
  }

  /**
   * Walk through PDF operator list to find paintImageXObject operations
   * and extract their bounding boxes from the transform matrices.
   */
  private collectImageRegions(ops: any, viewport: any): RawImageRegion[] {
    const regions: RawImageRegion[] = []
    const OPS = pdfjs.OPS
    // Track current transformation matrix
    const matrixStack: number[][] = []
    let ctm = [1, 0, 0, 1, 0, 0] // identity

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const args = ops.argsArray[i]

      if (fn === OPS.save) {
        matrixStack.push([...ctm])
      } else if (fn === OPS.restore) {
        ctm = matrixStack.pop() || [1, 0, 0, 1, 0, 0]
      } else if (fn === OPS.transform) {
        // Multiply current CTM by new transform
        const [a, b, c, d, e, f] = args
        const [ca, cb, cc, cd, ce, cf] = ctm
        ctm = [
          ca * a + cc * b,
          cb * a + cd * b,
          ca * c + cc * d,
          cb * c + cd * d,
          ca * e + cc * f + ce,
          cb * e + cd * f + cf,
        ]
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        // Image paint operation — extract bounding box from CTM
        // CTM maps unit square [0,1]×[0,1] to page coordinates
        const [scaleX, , , scaleY, tx, ty] = ctm
        // Convert from PDF coordinates (origin bottom-left) to viewport coordinates (origin top-left)
        const pdfX = tx
        const pdfY = ty
        const pdfW = Math.abs(scaleX)
        const pdfH = Math.abs(scaleY)

        // PDF Y is bottom-up, viewport Y is top-down
        const x = pdfX
        const y = viewport.height - pdfY - (scaleY < 0 ? 0 : pdfH)
        const width = pdfW
        const height = pdfH

        regions.push({ x, y, width, height })
      }
    }
    return regions
  }

  /** Filter out background images (scanned PDF pattern) and tiny decorations */
  private isMeaningfulImageRegion(region: RawImageRegion, pageWidth: number, pageHeight: number): boolean {
    const area = region.width * region.height
    const pageArea = pageWidth * pageHeight
    // Too small to be a figure
    if (region.width < 60 || region.height < 40) return false
    if (area < 3500) return false
    // Covers most of the page — likely a scanned background image
    if (region.width > pageWidth * 0.8 && region.height > pageHeight * 0.8) return false
    if (area > pageArea * 0.60) return false
    // Negative coordinates — off-page decoration
    if (region.x < -5 || region.y < -5) return false
    return true
  }

  /** Remove duplicate/overlapping image regions */
  private dedupeImageRegions(regions: RawImageRegion[]): RawImageRegion[] {
    if (regions.length <= 1) return regions
    const result: RawImageRegion[] = []
    for (const r of regions) {
      const isDupe = result.some(existing => {
        const dx = Math.abs(existing.x - r.x)
        const dy = Math.abs(existing.y - r.y)
        const dw = Math.abs(existing.width - r.width)
        const dh = Math.abs(existing.height - r.height)
        return dx < 5 && dy < 5 && dw < 10 && dh < 10
      })
      if (!isDupe) result.push(r)
    }
    return result
  }

  /**
   * Crop a detected image region from the rendered canvas.
   * Uses generous horizontal padding to capture full figures (e.g. pie charts
   * that extend beyond the detected transform bounds).
   */
  private cropImageRegion(
    source: HTMLCanvasElement,
    region: RawImageRegion,
    renderScale: number,
    pageWidth: number,
  ): string {
    // Use wider padding for figures that span a large portion of the page
    const widthRatio = region.width / pageWidth
    const horizontalPadding = widthRatio > 0.4 ? Math.max(60, region.width * 0.4) : 16
    const topPadding = 24
    const bottomPadding = 8

    const cropX = Math.max(0, Math.floor((region.x - horizontalPadding) * renderScale))
    const cropY = Math.max(0, Math.floor((region.y - topPadding) * renderScale))
    const cropRight = Math.min(source.width, Math.ceil((region.x + region.width + horizontalPadding) * renderScale))
    const cropBottom = Math.min(source.height, Math.ceil((region.y + region.height + bottomPadding) * renderScale))
    const cropWidth = Math.max(1, cropRight - cropX)
    const cropHeight = Math.max(1, cropBottom - cropY)

    const canvas = document.createElement('canvas')
    canvas.width = cropWidth
    canvas.height = cropHeight
    const context = canvas.getContext('2d')
    if (!context) return ''
    context.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
    return canvas.toDataURL('image/png')
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
    } catch (e) {
      this.onDebugLog?.(`Error resolving destination page: ${e instanceof Error ? e.message : String(e)}`);
      return null
    }
  }
}
