'use client'

import { useState, useEffect } from 'react'

interface PageThumbnailProps {
  pdfBlob: Blob
  pageNumber: number
  width?: number
  selected?: boolean
  onClick?: () => void
}

export function PageThumbnail({ pdfBlob, pageNumber, width = 100, selected, onClick }: PageThumbnailProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const { PDFService } = await import('@/lib/services/pdf-service')
        const pdfSvc = new PDFService()
        const src = await pdfSvc.renderPageToImage(pdfBlob, pageNumber, 0.5)
        if (!cancelled) {
          setImageSrc(src)
          setLoading(false)
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true }
  }, [pdfBlob, pageNumber])

  const height = Math.round(width * 1.4)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 flex-shrink-0 cursor-pointer transition-all ${
        selected ? 'ring-2 ring-blue-500 rounded-md' : ''
      }`}
    >
      {loading || !imageSrc ? (
        <div
          className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground"
          style={{ width, height }}
        >
          {pageNumber}
        </div>
      ) : (
        <img
          src={imageSrc}
          alt={`Page ${pageNumber}`}
          className="rounded object-cover"
          style={{ width, height }}
        />
      )}
      <span className="text-[10px] text-muted-foreground">{pageNumber}</span>
    </button>
  )
}
