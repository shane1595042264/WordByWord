'use client'

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'

/** Describes a word's position on a PDF page (in CSS pixels relative to the page wrapper) */
export interface PDFTextPosition {
  text: string
  pageNum: number
  x: number      // left offset in px (at rendered scale)
  y: number      // top offset in px (at rendered scale)
  width: number
  height: number
}

/** Info needed to highlight a word on the PDF */
export interface HighlightWordInfo {
  text: string
  pageNumber: number
  sentenceText: string
  /** 0-based index of the word within its sentence */
  wordIndex: number
  /** Direct PDF user-space bounding box (bypasses text search when available) */
  pdfRect?: { pageNumber: number; x: number; y: number; width: number; height: number }
}

/** Imperative handle for controlling the PDF viewer */
export interface PDFViewerHandle {
  /** Scroll the PDF to show a specific page (absolute page number) */
  scrollToPage: (pageNum: number, behavior?: ScrollBehavior) => void
}

interface PDFViewerProps {
  pdfBlob: Blob
  startPage: number
  endPage: number
  readingMode: 'scroll' | 'flip'
  /** Controlled current page for flip mode (absolute page number) */
  currentPage?: number
  /** Called when page changes in flip mode */
  onPageChange?: (page: number) => void
  onPageProgress?: (currentPage: number, totalPages: number, scrollPercent: number) => void
  /** Optional external ref to the scroll container (for sync scrolling) */
  scrollRef?: RefObject<HTMLDivElement | null>
  /** Word to highlight on the PDF */
  highlightWord?: HighlightWordInfo | null
  /** Imperative handle ref */
  pdfViewerRef?: RefObject<PDFViewerHandle | null>
  /** The original section end page (before overlap extension). Pages after this
   *  are overlap pages and will show a "section ends" divider. */
  sectionEndPage?: number
}

export function PDFViewer({ pdfBlob, startPage, endPage, readingMode, currentPage: controlledPage, onPageChange, onPageProgress, scrollRef, highlightWord, pdfViewerRef, sectionEndPage }: PDFViewerProps) {
  const internalRef = useRef<HTMLDivElement>(null)
  // Use a callback ref to assign to both internal and external refs
  const containerRef = internalRef
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    (internalRef as any).current = node
    if (scrollRef) (scrollRef as any).current = node
  }, [scrollRef])
  const [error, setError] = useState<string | null>(null)
  const currentFlipPage = controlledPage ?? startPage
  const totalPages = endPage - startPage + 1

  // Expose imperative handle for scrolling to a page
  useEffect(() => {
    if (!pdfViewerRef) return
    ;(pdfViewerRef as any).current = {
      scrollToPage(pageNum: number, behavior: ScrollBehavior = 'smooth') {
        const wrapper = pageWrappersRef.current.get(pageNum)
        const container = containerRef.current
        if (!wrapper || !container) return
        // Scroll the page wrapper to the top of the container
        const wrapperTop = wrapper.offsetTop
        container.scrollTo({ top: wrapperTop, behavior })
      },
    }
    return () => {
      if (pdfViewerRef) (pdfViewerRef as any).current = null
    }
  }, [pdfViewerRef])

  // Store extracted text positions per page: Map<pageNum, PDFTextPosition[]>
  const textPositionsRef = useRef<Map<number, PDFTextPosition[]>>(new Map())
  // Store viewport info per page for converting PDF user-space coords to viewport coords
  const viewportInfoRef = useRef<Map<number, { scale: number; viewport: any }>>(new Map())
  // Store page wrapper elements for overlay positioning: Map<pageNum, HTMLDivElement>
  const pageWrappersRef = useRef<Map<number, HTMLDivElement>>(new Map())

  // Highlight overlay state
  const [highlightRect, setHighlightRect] = useState<{
    pageNum: number; x: number; y: number; width: number; height: number
  } | null>(null)

  const setCurrentFlipPage = useCallback((updater: number | ((p: number) => number)) => {
    const newPage = typeof updater === 'function' ? updater(currentFlipPage) : updater
    onPageChange?.(newPage)
  }, [currentFlipPage, onPageChange])

  // Report progress for flip mode
  useEffect(() => {
    if (readingMode === 'flip') {
      const pageIndex = currentFlipPage - startPage + 1
      const percent = Math.round((pageIndex / totalPages) * 100)
      onPageProgress?.(currentFlipPage, totalPages, percent)
    }
  }, [currentFlipPage, readingMode, startPage, totalPages, onPageProgress])

  /**
   * Extract text positions from a PDF page using getTextContent().
   * Uses the viewport transform to convert from PDF coords to screen coords.
   *
   * PDF text items have a transform matrix [scaleX, skewX, skewY, scaleY, tx, ty].
   * The viewport's own transform converts PDF coords (origin bottom-left) to
   * screen coords (origin top-left).  We multiply item.transform by the viewport
   * transform to get the final CSS-pixel position of each text run.
   */
  const extractTextPositions = useCallback(async (
    page: any, // PDFPageProxy
    pageNum: number,
    viewport: any, // PageViewport
  ): Promise<PDFTextPosition[]> => {
    const textContent = await page.getTextContent()
    const positions: PDFTextPosition[] = []

    for (const item of textContent.items) {
      if (!item.str || item.str.trim() === '') continue

      // The item.transform is [a, b, c, d, tx, ty] in PDF user-space.
      // viewport.transform is the 6-element matrix that maps PDF→viewport.
      // Multiply them to get the final screen-space transform.
      const tx = item.transform[4]
      const ty = item.transform[5]
      const fontHeight = item.height  // item.height is already in PDF units

      // Use viewport to convert the text origin point
      const [vx, vy] = viewport.convertToViewportPoint(tx, ty)

      // item.width is in PDF user-space units — scale to viewport pixels
      const scaledWidth = item.width * viewport.scale
      // Font height: use item.height if available, else fall back to transform scaleY
      const rawHeight = fontHeight || Math.abs(item.transform[3])
      const scaledHeight = rawHeight * viewport.scale

      // After convertToViewportPoint, vy is in top-down screen coords at the
      // text baseline.  Subtract scaledHeight to get the top edge of the glyph.
      positions.push({
        text: item.str,
        pageNum,
        x: vx,
        y: vy - scaledHeight,
        width: scaledWidth,
        height: scaledHeight,
      })
    }

    return positions
  }, [])

  // Track which pages have been rendered to avoid re-rendering
  const renderedPagesRef = useRef<Set<number>>(new Set())
  // Track the pdf document instance for lazy rendering
  const pdfDocRef = useRef<any>(null)
  // Track container width for consistent scaling
  const containerWidthRef = useRef(0)

  // Scroll mode: create placeholders for all pages, then lazily render
  // visible + nearby pages using IntersectionObserver with a generous rootMargin
  useEffect(() => {
    if (readingMode !== 'scroll') return
    let cancelled = false

    const setup = async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ''
        textPositionsRef.current.clear()
        pageWrappersRef.current.clear()
        renderedPagesRef.current.clear()

        const containerWidth = container.clientWidth
        containerWidthRef.current = containerWidth

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
        if (cancelled) { doc.destroy(); return }
        pdfDocRef.current = doc

        // Phase 1: Create placeholder divs for all pages with correct dimensions
        // This gives the scroll container its full height immediately.
        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
          if (cancelled) { doc.destroy(); return }
          const page = await doc.getPage(pageNum)
          const unscaledViewport = page.getViewport({ scale: 1 })
          const scale = containerWidth / unscaledViewport.width
          const viewport = page.getViewport({ scale })

          const pageWrapper = document.createElement('div')
          pageWrapper.style.position = 'relative'
          pageWrapper.style.width = '100%'
          // Set the height so the scroll container has correct total height
          pageWrapper.style.height = `${viewport.height}px`
          pageWrapper.style.backgroundColor = '#f8f8f8'
          pageWrapper.dataset.pageNum = String(pageNum)
          pageWrapper.dataset.viewportWidth = String(viewport.width)
          pageWrapper.dataset.viewportHeight = String(viewport.height)
          pageWrapper.dataset.scale = String(scale)

          if (!cancelled) {
            container.appendChild(pageWrapper)
            pageWrappersRef.current.set(pageNum, pageWrapper)

            // Add section-end divider after the last official section page
            if (sectionEndPage && pageNum === sectionEndPage && endPage > sectionEndPage) {
              const divider = document.createElement('div')
              divider.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;background:#18181b;color:#71717a;font-size:11px;font-family:monospace;'
              const line1 = document.createElement('div')
              line1.style.cssText = 'flex:1;height:1px;background:linear-gradient(to right,#3f3f46,transparent)'
              const label = document.createElement('span')
              label.textContent = '— section ends above —'
              const line2 = document.createElement('div')
              line2.style.cssText = 'flex:1;height:1px;background:linear-gradient(to left,#3f3f46,transparent)'
              divider.append(line1, label, line2)
              container.appendChild(divider)
            }
          }
        }

        // Phase 2: Use IntersectionObserver to render pages as they approach the viewport
        // rootMargin of 200% means we pre-render pages 2 viewports ahead/behind
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              const pageNum = Number((entry.target as HTMLElement).dataset.pageNum)
              if (renderedPagesRef.current.has(pageNum)) continue
              renderPage(pageNum)
            }
          },
          { root: container, rootMargin: '200% 0px 200% 0px', threshold: 0 }
        )

        // Observe all page wrappers
        for (const [, wrapper] of pageWrappersRef.current) {
          observer.observe(wrapper)
        }

        // Phase 3: Eagerly render first 3 pages for instant display
        const eagerPages = Math.min(3, endPage - startPage + 1)
        for (let i = 0; i < eagerPages; i++) {
          if (cancelled) break
          await renderPage(startPage + i)
        }

        return () => {
          observer.disconnect()
        }
      } catch {
        if (!cancelled) setError('Failed to render PDF')
      }
    }

    /** Render a single page into its placeholder wrapper */
    const renderPage = async (pageNum: number) => {
      if (cancelled || renderedPagesRef.current.has(pageNum)) return
      renderedPagesRef.current.add(pageNum)

      const doc = pdfDocRef.current
      const wrapper = pageWrappersRef.current.get(pageNum)
      if (!doc || !wrapper) return

      try {
        const page = await doc.getPage(pageNum)
        const scale = Number(wrapper.dataset.scale) || 1
        const viewport = page.getViewport({ scale })

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        canvas.style.display = 'block'
        canvas.dataset.pageNum = String(pageNum)

        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

        // Extract text positions for this page
        const positions = await extractTextPositions(page, pageNum, viewport)
        textPositionsRef.current.set(pageNum, positions)
        // Store viewport info for pdfRect → viewport coordinate conversion
        viewportInfoRef.current.set(pageNum, { scale, viewport })

        if (!cancelled) {
          // Replace placeholder content with rendered canvas
          wrapper.innerHTML = ''
          wrapper.style.height = 'auto' // let canvas determine height now
          wrapper.style.backgroundColor = ''
          wrapper.appendChild(canvas)
        }
      } catch {
        // Mark as not rendered so it can be retried
        renderedPagesRef.current.delete(pageNum)
      }
    }

    setup()
    return () => {
      cancelled = true
      // Don't destroy the doc here — the IntersectionObserver callbacks may still fire
      // The doc will be replaced on next effect run
    }
  }, [pdfBlob, startPage, endPage, readingMode, extractTextPositions])

  // Scroll mode: track scroll progress
  useEffect(() => {
    if (readingMode !== 'scroll') return
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const percent = scrollHeight <= clientHeight ? 100 : Math.round((scrollTop / (scrollHeight - clientHeight)) * 100)

      // Figure out which page is in view
      const canvases = container.querySelectorAll('canvas[data-page-num]')
      let visiblePage = startPage
      for (const canvas of canvases) {
        const rect = canvas.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
          visiblePage = Number(canvas.getAttribute('data-page-num'))
          break
        }
      }
      onPageProgress?.(visiblePage, totalPages, percent)
    }

    container.addEventListener('scroll', handleScroll)
    // Check once after render
    const timer = setTimeout(handleScroll, 500)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(timer)
    }
  }, [readingMode, startPage, totalPages, onPageProgress])

  // Flip mode: render single page, scale to fill
  useEffect(() => {
    if (readingMode !== 'flip') return
    let cancelled = false

    const render = async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ''
        textPositionsRef.current.clear()
        pageWrappersRef.current.clear()

        const containerWidth = container.clientWidth

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
        const page = await doc.getPage(currentFlipPage)
        const unscaledViewport = page.getViewport({ scale: 1 })
        const scale = containerWidth / unscaledViewport.width
        const viewport = page.getViewport({ scale })

        // Page wrapper for overlay
        const pageWrapper = document.createElement('div')
        pageWrapper.style.position = 'relative'
        pageWrapper.style.width = '100%'
        pageWrapper.dataset.pageNum = String(currentFlipPage)

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        canvas.style.display = 'block'

        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise

        // Extract text positions
        const positions = await extractTextPositions(page, currentFlipPage, viewport)
        textPositionsRef.current.set(currentFlipPage, positions)
        viewportInfoRef.current.set(currentFlipPage, { scale, viewport })

        if (!cancelled) {
          pageWrapper.appendChild(canvas)
          container.appendChild(pageWrapper)
          pageWrappersRef.current.set(currentFlipPage, pageWrapper)
        }
        doc.destroy()
      } catch {
        if (!cancelled) setError('Failed to render PDF')
      }
    }
    render()
    return () => { cancelled = true }
  }, [pdfBlob, currentFlipPage, readingMode, extractTextPositions])

  // ── Highlight word matching ──
  // When highlightWord changes, find the matching text position on the PDF.
  // If pdfRect is available (stored during parsing), convert directly from
  // PDF user-space to viewport coordinates — no text searching needed.
  // Falls back to text-based search when pdfRect is not available.
  useEffect(() => {
    if (!highlightWord) {
      setHighlightRect(null)
      return
    }

    const { text: wordText, pageNumber, sentenceText, wordIndex, pdfRect } = highlightWord

    // ── Fast path: use pdfRect (precise, no text search) ──
    if (pdfRect) {
      const sourcePageNum = pdfRect.pageNumber
      const vpInfo = viewportInfoRef.current.get(sourcePageNum)
      if (vpInfo) {
        const { viewport } = vpInfo
        // Convert from PDF user-space to viewport coordinates
        const [vx, vy] = viewport.convertToViewportPoint(pdfRect.x, pdfRect.y)
        const scaledWidth = pdfRect.width * viewport.scale
        const rawHeight = pdfRect.height || 10
        const scaledHeight = rawHeight * viewport.scale
        setHighlightRect({
          pageNum: sourcePageNum,
          x: vx,
          y: vy - scaledHeight,
          width: scaledWidth,
          height: scaledHeight,
        })
        return
      }
      // Viewport not ready yet — fall through to text search as fallback
    }

    // ── Fallback: text-based search ──
    // Due to cross-page paragraph merging, the reported pageNumber may not be
    // where the word actually appears on the PDF. We search the reported page
    // first, then search nearby pages (±3) as fallback.
    const tryPage = (pn: number): { pageNum: number; x: number; y: number; width: number; height: number } | null => {
      const positions = textPositionsRef.current.get(pn)
      if (!positions || positions.length === 0) return null
      const match = findWordInTextPositions(positions, wordText, sentenceText, wordIndex)
      if (match) return { pageNum: pn, ...match }
      return null
    }

    let result = tryPage(pageNumber)

    // If not found on reported page, search nearby pages (±3)
    if (!result) {
      for (let offset = 1; offset <= 3; offset++) {
        result = tryPage(pageNumber + offset) || tryPage(pageNumber - offset)
        if (result) break
      }
    }

    if (result) {
      setHighlightRect(result)
    } else {
      setHighlightRect(null)
    }
  }, [highlightWord])

  // Render overlay highlight elements into page wrappers
  useEffect(() => {
    // Clean up any existing overlays
    for (const [, wrapper] of pageWrappersRef.current) {
      const existing = wrapper.querySelector('.pdf-word-highlight')
      if (existing) existing.remove()
    }

    if (!highlightRect) return

    const wrapper = pageWrappersRef.current.get(highlightRect.pageNum)
    if (!wrapper) return

    // The canvas is rendered at full resolution but displayed at 100% width.
    // We need to account for the scale between canvas resolution and displayed size.
    const canvas = wrapper.querySelector('canvas')
    if (!canvas) return
    const displayScale = canvas.clientWidth / canvas.width

    const overlay = document.createElement('div')
    overlay.className = 'pdf-word-highlight'
    overlay.style.position = 'absolute'
    overlay.style.left = `${highlightRect.x * displayScale}px`
    overlay.style.top = `${highlightRect.y * displayScale}px`
    overlay.style.width = `${highlightRect.width * displayScale}px`
    overlay.style.height = `${highlightRect.height * displayScale}px`
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.35)' // blue highlight
    overlay.style.border = '2px solid rgba(59, 130, 246, 0.8)'
    overlay.style.borderRadius = '2px'
    overlay.style.pointerEvents = 'none'
    overlay.style.zIndex = '10'
    overlay.style.boxShadow = '0 0 6px rgba(59, 130, 246, 0.5)'
    overlay.style.transition = 'all 0.2s ease'
    // Pad slightly to make the highlight more visible around the word
    overlay.style.padding = '2px 1px'
    overlay.style.margin = '-2px -1px'
    // Add a subtle pulse animation
    overlay.style.animation = 'pulse-highlight 1.5s ease-in-out infinite'

    wrapper.appendChild(overlay)

    // Scroll the highlight into view within the PDF scroll container
    requestAnimationFrame(() => {
      overlay.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })

    return () => {
      overlay.remove()
    }
  }, [highlightRect])

  // Keyboard navigation for flip mode
  const goNext = useCallback(() => {
    if (currentFlipPage < endPage) setCurrentFlipPage(p => p + 1)
  }, [currentFlipPage, endPage])

  const goPrev = useCallback(() => {
    if (currentFlipPage > startPage) setCurrentFlipPage(p => p - 1)
  }, [currentFlipPage, startPage])

  useEffect(() => {
    if (readingMode !== 'flip') return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        goNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        goPrev()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [readingMode, goNext, goPrev])

  if (error) return <div className="text-red-500 p-4">{error}</div>

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @keyframes pulse-highlight {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
      <div
        ref={setContainerRef}
        className={readingMode === 'scroll' ? 'flex-1 overflow-auto' : 'flex-1 overflow-hidden'}
      />
    </div>
  )
}

/**
 * Find the position of a specific word in the PDF text items.
 *
 * PDF text items are chunks (often multiple words per chunk). We need to:
 * 1. Build a running text from all items to locate the sentence context
 * 2. Find which text item contains the target word
 * 3. Estimate the word's x-position within that text item
 */
function findWordInTextPositions(
  positions: PDFTextPosition[],
  wordText: string,
  sentenceText: string,
  wordIndex: number,
): { x: number; y: number; width: number; height: number } | null {
  // Build a combined text string from all positions, tracking character offsets
  const combined: { text: string; posIndex: number; charStart: number }[] = []
  let fullText = ''

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i]
    combined.push({ text: pos.text, posIndex: i, charStart: fullText.length })
    fullText += pos.text
    // Add space between items if the next item doesn't start right after
    if (i < positions.length - 1) {
      fullText += ' '
    }
  }

  // Try to find the sentence in the combined text (normalized whitespace)
  const normalizedFull = fullText.replace(/\s+/g, ' ')
  const normalizedSentence = sentenceText.replace(/\s+/g, ' ').trim()

  // Find sentence location
  let sentenceStart = normalizedFull.indexOf(normalizedSentence)

  // If exact match fails, try fuzzy — find a substring that matches most words
  if (sentenceStart === -1) {
    // Try finding just the word with some surrounding context
    const words = normalizedSentence.split(' ')
    const start = Math.max(0, wordIndex - 2)
    const end = Math.min(words.length, wordIndex + 3)
    const contextSnippet = words.slice(start, end).join(' ')
    sentenceStart = normalizedFull.indexOf(contextSnippet)

    if (sentenceStart === -1) {
      // Last resort: just find the word itself (first occurrence)
      return findWordDirectly(positions, wordText)
    }

    // Adjust wordIndex relative to the snippet
    const adjustedWordIndex = wordIndex - start
    return findWordAtIndex(positions, combined, normalizedFull, sentenceStart, contextSnippet, adjustedWordIndex, wordText)
  }

  return findWordAtIndex(positions, combined, normalizedFull, sentenceStart, normalizedSentence, wordIndex, wordText)
}

/** Find a word at a specific index within a sentence found in the full text */
function findWordAtIndex(
  positions: PDFTextPosition[],
  combined: { text: string; posIndex: number; charStart: number }[],
  normalizedFull: string,
  sentenceStart: number,
  sentenceText: string,
  wordIndex: number,
  wordText: string,
): { x: number; y: number; width: number; height: number } | null {
  // Find the nth word within the sentence
  const sentenceWords = sentenceText.split(/\s+/)
  if (wordIndex >= sentenceWords.length) {
    return findWordDirectly(positions, wordText)
  }

  // Calculate the character offset of the target word within the full text
  let charOffset = sentenceStart
  for (let i = 0; i < wordIndex; i++) {
    charOffset += sentenceWords[i].length + 1 // +1 for space
  }

  // Find which text item contains this character offset
  // Map from normalized offset back to approximate position in the items
  for (let i = 0; i < combined.length; i++) {
    const item = combined[i]
    const itemEnd = item.charStart + item.text.length
    // Check if target word starts within this text item (allowing for spaces)
    if (charOffset >= item.charStart && charOffset < itemEnd + 1) {
      const pos = positions[item.posIndex]
      // Estimate x-position within the text item
      const charInItem = Math.max(0, charOffset - item.charStart)
      const itemCharCount = pos.text.length || 1
      const charWidth = pos.width / itemCharCount
      const wordWidth = charWidth * wordText.length

      return {
        x: pos.x + charInItem * charWidth,
        y: pos.y,
        width: Math.max(wordWidth, 8), // minimum 8px width
        height: pos.height,
      }
    }
  }

  return findWordDirectly(positions, wordText)
}

/** Fallback: find a word by direct text match in the positions array */
function findWordDirectly(
  positions: PDFTextPosition[],
  wordText: string,
): { x: number; y: number; width: number; height: number } | null {
  // Look for an exact text item match first
  for (const pos of positions) {
    if (pos.text.trim() === wordText) {
      return { x: pos.x, y: pos.y, width: pos.width, height: pos.height }
    }
  }

  // Look for a text item containing the word
  for (const pos of positions) {
    const idx = pos.text.indexOf(wordText)
    if (idx !== -1) {
      const itemCharCount = pos.text.length || 1
      const charWidth = pos.width / itemCharCount
      return {
        x: pos.x + idx * charWidth,
        y: pos.y,
        width: charWidth * wordText.length,
        height: pos.height,
      }
    }
  }

  return null
}
