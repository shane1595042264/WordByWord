'use client'

import { useState, useEffect, useRef } from 'react'
import type { PdfPageRenderer } from '@/lib/services/pdf-service'

interface PageThumbnailProps {
  /** Shared renderer for the whole strip. Null while it is still being built. */
  renderer: PdfPageRenderer | null
  pageNumber: number
  width?: number
  /** True while the strip is in TOC-select mode, i.e. the tile acts as a toggle. */
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
}

export function PageThumbnail({ renderer, pageNumber, width = 100, selectable, selected, onClick }: PageThumbnailProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Only pages that have been scrolled near are worth rendering — a book strip
  // can hold hundreds of tiles and each render costs a real pdf.js page decode.
  // Environments without IntersectionObserver fall back to rendering eagerly.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (visible) return
    const el = buttonRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '300px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || !renderer) return
    let cancelled = false

    async function render() {
      try {
        const src = await renderer!.renderPage(pageNumber, 0.5)
        if (!cancelled) setImageSrc(src)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    render()
    return () => { cancelled = true }
  }, [renderer, pageNumber, visible])

  const height = Math.round(width * 1.4)

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      // Without an explicit name the tile announces as "Page 5 5" once rendered
      // and "5 5" while it is still a placeholder. aria-pressed is only meaningful
      // in TOC-select mode — outside it the tile is not a toggle.
      aria-label={`Page ${pageNumber}`}
      aria-pressed={selectable ? !!selected : undefined}
      className={`flex flex-col items-center gap-1 flex-shrink-0 cursor-pointer transition-all ${
        selected ? 'ring-2 ring-blue-500 rounded-md' : ''
      }`}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={`Page ${pageNumber}`}
          className="rounded object-cover"
          style={{ width, height }}
        />
      ) : (
        <div
          className={`rounded flex flex-col items-center justify-center gap-0.5 text-xs ${
            failed
              ? 'bg-red-50 border border-red-200 text-red-600'
              : 'bg-muted text-muted-foreground'
          }`}
          style={{ width, height }}
          title={failed ? `Page ${pageNumber} failed to render` : undefined}
        >
          <span>{pageNumber}</span>
          {failed && <span className="text-[9px] leading-tight">Preview failed</span>}
        </div>
      )}
      <span className="text-[10px] text-muted-foreground">{pageNumber}</span>
    </button>
  )
}
