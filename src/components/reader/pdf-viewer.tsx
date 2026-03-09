'use client'

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react'

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
}

export function PDFViewer({ pdfBlob, startPage, endPage, readingMode, currentPage: controlledPage, onPageChange, onPageProgress, scrollRef }: PDFViewerProps) {
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

  // Scroll mode: render all pages, scale to full width
  useEffect(() => {
    if (readingMode !== 'scroll') return
    let cancelled = false

    const render = async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

        const container = containerRef.current
        if (!container || cancelled) return
        container.innerHTML = ''

        const containerWidth = container.clientWidth

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise

        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
          if (cancelled) { doc.destroy(); return }
          const page = await doc.getPage(pageNum)
          // Scale to fill container width
          const unscaledViewport = page.getViewport({ scale: 1 })
          const scale = containerWidth / unscaledViewport.width
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
          if (!cancelled) container.appendChild(canvas)
        }
        doc.destroy()
      } catch {
        if (!cancelled) setError('Failed to render PDF')
      }
    }
    render()
    return () => { cancelled = true }
  }, [pdfBlob, startPage, endPage, readingMode])

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

        const containerWidth = container.clientWidth

        const arrayBuffer = await pdfBlob.arrayBuffer()
        const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise
        const page = await doc.getPage(currentFlipPage)
        const unscaledViewport = page.getViewport({ scale: 1 })
        const scale = containerWidth / unscaledViewport.width
        const viewport = page.getViewport({ scale })

        const canvas = document.createElement('canvas')
        canvas.width = viewport.width
        canvas.height = viewport.height
        canvas.style.width = '100%'
        canvas.style.height = 'auto'
        canvas.style.display = 'block'

        const ctx = canvas.getContext('2d')!
        await page.render({ canvasContext: ctx, viewport, canvas } as any).promise
        if (!cancelled) container.appendChild(canvas)
        doc.destroy()
      } catch {
        if (!cancelled) setError('Failed to render PDF')
      }
    }
    render()
    return () => { cancelled = true }
  }, [pdfBlob, currentFlipPage, readingMode])

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
      <div
        ref={setContainerRef}
        className={readingMode === 'scroll' ? 'flex-1 overflow-auto' : 'flex-1 overflow-hidden'}
      />
    </div>
  )
}
