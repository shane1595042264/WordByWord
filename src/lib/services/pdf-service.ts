import * as pdfjs from 'pdfjs-dist'
import type { RawTextItem, RawPageData, RawImageRegion, NibDocumentData } from '@/lib/nib'
import { NibParser } => from '@/lib/nib/parser'
import { NibTextParser } from '@/lib/nib/text-parser'

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
    this.onDebugLog?.("PDFService: Starting metadata extraction...");
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
      this.onDebugLog?.(`PDFService: Extracted metadata: Title="${result.title}", Author="${result.author}", TotalPages=${result.totalPages}`);
      return result;
    } finally {
      doc.destroy()
      this.onDebugLog?.("PDFService: Finished metadata extraction.");
    }
  }

  async extractOutline(blob: Blob): Promise<PDFOutlineItem[] | null> {
    this.onDebugLog?.("PDFService: Starting outline extraction...");
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const outline = await doc.getOutline()
      if (!outline || outline.length === 0) {
        this.onDebugLog?.("PDFService: No outline found.");
        return null
      }
      this.onDebugLog?.(`PDFService: Found ${outline.length} top-level outline items.`);
      const items = await this.mapOutlineItems(outline, doc)
      this.onDebugLog?.("PDFService: Finished outline extraction.");
      return items
    } finally {
      doc.destroy()
    }
  }

  async renderPageToImage(blob: Blob, pageNumber: number, scale: number = 2): Promise<string> {
    if (typeof window === 'undefined') {
      this.onDebugLog?.("PDFService: Skipping renderPageToImage on server.");
      return '';
    }
    this.onDebugLog?.(`PDFService: Rendering page ${pageNumber} to image (scale: ${scale})...`);
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
      this.onDebugLog?.(`PDFService: Successfully rendered page ${pageNumber} to image.`);
      return result;
    } finally {
      doc.destroy()
    }
  }

  async extractPageText(blob: Blob, pageNumber: number): Promise<string> {
    this.onDebugLog?.(`PDFService: Extracting raw text from page ${pageNumber}...`);
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const page = await doc.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const text = textContent.items.map((item: any) => item.str).join(' ');
      this.onDebugLog?.(`PDFService: Extracted ${textContent.items.length} text items from page ${pageNumber}.`);
      return text;
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract all text from the PDF, concatenating page by page.
   * This is used for "general PDFs" where rich parsing might not be effective.
   */
  async extractAllText(blob: Blob): Promise<string> {
    this.onDebugLog?.("PDFService: Extracting all text from document...");
    const arrayBuffer = await blob.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n\n'; // Add double newline as a page separator heuristic
        this.onDebugLog?.(`PDFService: Extracted text from page ${i}.`);
      }
      this.onDebugLog?.("PDFService: Finished extracting all text.");
      return fullText.trim();
    } finally {
      doc.destroy();
    }
  }

  /**
   * Extract rich text data from a page, including position and font info.
   * This powers the .nib parser for header/footnote detection.
   */
  async extractRichPageData(blob: Blob, pageNumber: number): Promise<RawPageData> {
    this.onDebugLog?.(`PDFService: Extracting rich data from page ${pageNumber}...`);
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
      this.onDebugLog?.(`PDFService: Page ${pageNumber}: Extracted ${items.length} text items.`);

      const result = {
        pageNumber,
        items,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
      };
      this.onDebugLog?.(`PDFService: Finished rich data extraction for page ${pageNumber}.`);
      return result;
    } finally {
      doc.destroy()
    }
  }

  /**
   * Extract rich text data for a range of pages at once (more efficient).
   */
  async extractRichPageRange(blob: Blob, startPage: number, endPage: number): Promise<RawPageData[]> {
    if (typeof window === 'undefined') {
      this.onDebugLog?.("PDFService: Skipping extractRichPageRange on server.");
      return [];
    }
    this.onDebugLog?.(`PDFService: Starting rich data extraction for pages ${startPage}-${endPage}...`);
    const arrayBuffer = await blob.arrayBuffer()
    const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
    try {
      const results: RawPageData[] = []
      for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        this.onDebugLog?.(`PDFService: Processing page ${pageNum} for rich data...`);
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
          this.onDebugLog?.(`PDFService: Page ${pageNum}: Detected ${images.length} image regions.`);
        } catch (e) {
          this.onDebugLog?.(`PDFService: Page ${pageNum}: Error extracting images: ${e instanceof Error ? e.message : String(e)}`);
        }


        // Build a map from font ID → actual font name (e.g. "TimesNewRomanPS-BoldMT")
        const fontNameMap = new Map<string, string>()
        const seenFontIds = new Set<string>()
        for (const item of textContent.items as any[]) {
          if (item.fontName) seenFontIds.add(item.fontName)
        }
        for (const fontId of seenFontIds) {
          try {
            const fontObj = page.commonObjs.get(fontId) // Reverted to page.commonObjs
            if (fontObj?.name) {
              fontNameMap.set(fontId, fontObj.name)
            }
          } catch {
            // Font not resolved — fall back to opaque ID
            this.onDebugLog?.(`PDFService: Page ${pageNum}: Could not resolve font name for ID: ${fontId}`);
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
        this.onDebugLog?.(`PDFService: Page ${pageNum}: Extracted ${items.length} text items.`);

        results.push({
          pageNumber: pageNum,
          items,
          pageHeight: viewport.height,
          pageWidth: viewport.width,
          images,
        })
        this.onDebugLog?.(`PDFService: Finished rich data processing for page ${pageNum}.`);
      }
      this.onDebugLog?.(`PDFService: Finished rich data extraction for pages ${startPage}-${endPage}.`);
      return results
    } finally {
      doc.destroy()
    }
  }

  /**
   * Processes a PDF document to extract structured text data,
   * intelligently choosing between rich PDF parsing (for structured PDFs)
   * and plain text parsing (for general/scanned PDFs without TOC).
   */
  async processPdfDocument(blob: Blob, title: string, author: string): Promise<NibDocumentData> {
    this.onDebugLog?.("PDFService: Starting document processing...");
    const metadata = await this.extractMetadata(blob);
    const outline = await this.extractOutline(blob);

    if (outline && outline.length > 0) {
      this.onDebugLog?.("PDFService: Outline detected. Using rich PDF parser.");
      const richPageData = await this.extractRichPageRange(blob, 1, metadata.totalPages);
      const nibParser = new NibParser();
      return nibParser.parseDocument(richPageData, title, author);
    } else {
      this.onDebugLog?.("PDFService: No outline detected. Using plain text parser for general PDF.");
      const fullText = await this.extractAllText(blob);
      const nibTextParser = new NibTextParser();
      // Use parseMultiPageText to leverage page break heuristics
      return nibTextParser.parseMultiPageText(fullText, title, author, 1);
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
      this.onDebugLog?.(`PDFService: Extracting images for page ${page.pageNumber}...`);
      const ops = await page.getOperatorList()
      const regions = this.collectImageRegions(ops, viewport)
      const meaningful = regions.filter(r =>
        this.isMeaningfulImageRegion(r, viewport.width, viewport.height)
      )
      const deduped = this.dedupeImageRegions(meaningful)
      this.onDebugLog?.(`PDFService: Page ${page.pageNumber}: Found ${regions.length} raw image regions, ${meaningful.length} meaningful, ${deduped.length} deduped.`);
      const croppedImages = deduped.map(region => ({
        ...region,
        imageSrc: this.cropImageRegion(renderedCanvas, region, renderScale, viewport.width),
      })).filter(r => r.imageSrc);
      this.onDebugLog?.(`PDFService: Page ${page.pageNumber}: Successfully cropped ${croppedImages.length} images.`);
      return croppedImages;
    } catch (e) {
      this.onDebugLog?.(`PDFService: Page ${page.pageNumber}: Error in extractPageImages: ${e instanceof Error ? e.message : String(e)}`);
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
    let ctm = [1, 0, 0, 1, 0, 0] // identity matrix [a, b, c, d, e, f]

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i]
      const args = ops.argsArray[i]

      if (fn === OPS.save) {
        matrixStack.push([...ctm])
      } else if (fn === OPS.restore) {
        ctm = matrixStack.pop() || [1, 0, 0, 1, 0, 0]
      } else if (fn === OPS.transform) {
        // Multiply current CTM by new transform [a, b, c, d, e, f]
        const [a, b, c, d, e, f] = args
        const [ca, cb, cc, cd, ce, cf] = ctm
        ctm = [
          ca * a + cc * b, // new a
          cb * a + cd * b, // new b
          ca * c + cc * d, // new c
          cb * c + cd * d, // new d
          ca * e + cc * f + ce, // new e (translateX)
          cb * e + cd * f + cf, // new f (translateY)
        ]
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        // Image paint operation — extract bounding box from CTM
        // CTM maps unit square [0,1]×[0,1] to page coordinates
        const [scaleX, , , scaleY, tx, ty] = ctm // tx, ty are the translation components

        const imgWidth = Math.abs(scaleX);
        const imgHeight = Math.abs(scaleY);

        // PDF Y coordinates are from bottom-left. Viewport Y are from top-left.
        // The y coordinate in RawImageRegion should be the top-left corner in viewport coordinates.
        // ty is the bottom-left Y coordinate in PDF space.
        // So, top-left Y in viewport space is viewport.height - (ty + imgHeight).
        const x = tx;
        const y = viewport.height - (ty + imgHeight);

        regions.push({ x, y, width: imgWidth, height: imgHeight });
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
    if (!context) {
      this.onDebugLog?.(`PDFService: Failed to get 2D context for cropping image region.`);
      return ''
    }
    context.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
    return canvas.toDataURL('image/png')
  }

  private async mapOutlineItems(
    items: any[],
    doc: pdfjs.PDFDocumentProxy,
  ): Promise<PDFOutlineItem[]> {
    const result: PDFOutlineItem[] = []
    for (const item of items) {
      this.onDebugLog?.(`PDFService: Mapping outline item: "${item.title}"`);
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
        this.onDebugLog?.(`PDFService: Resolving named destination: "${dest}"`);
        resolved = await doc.getDestination(dest)
      }
      if (!resolved || !Array.isArray(resolved)) {
        this.onDebugLog?.(`PDFService: Destination "${dest}" could not be resolved or is not an array.`);
        return null
      }
      // resolved[0] is a page ref object
      const pageRef = resolved[0]
      const pageIndex = await doc.getPageIndex(pageRef)
      this.onDebugLog?.(`PDFService: Resolved destination to page index ${pageIndex}.`);
      return pageIndex + 1 // PDF.js pages are 0-indexed, we use 1-indexed
    } catch (e) {
      this.onDebugLog?.(`PDFService: Error resolving destination page for "${dest}": ${e instanceof Error ? e.message : String(e)}`);
      return null
    }
  }
}
