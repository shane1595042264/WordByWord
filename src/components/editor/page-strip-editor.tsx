'use client'

import { useState, useRef, useCallback, useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageThumbnail } from './page-thumbnail'
import type { PdfPageRenderer } from '@/lib/services/pdf-service'

export interface Divider {
  page: number
  title: string
}

export interface PageStripEditorProps {
  pdfBlob: Blob
  startPage: number
  endPage: number
  totalBookPages: number
  bookRemoteId: string
  existingDividers: Divider[]
  level: 'chapter' | 'section'
  onSave: (dividers: Divider[]) => Promise<void>
  onClose: () => void
}

export function PageStripEditor({
  pdfBlob,
  startPage,
  endPage,
  totalBookPages,
  bookRemoteId,
  existingDividers,
  level,
  onSave,
  onClose,
}: PageStripEditorProps) {
  const [dividers, setDividers] = useState<Divider[]>(existingDividers)
  const [tocSelectMode, setTocSelectMode] = useState(false)
  const [selectedTocPages, setSelectedTocPages] = useState<Set<number>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [expectedCount, setExpectedCount] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [tocError, setTocError] = useState<string | null>(null)
  const [hoverGap, setHoverGap] = useState<number | null>(null)
  const [focusGap, setFocusGap] = useState<number | null>(null)
  // Page of a divider that was just added from the keyboard and should receive
  // focus once it renders. See the gap button's onClick for why this is needed.
  const [focusDividerPage, setFocusDividerPage] = useState<number | null>(null)
  const [renderer, setRenderer] = useState<PdfPageRenderer | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const expectedCountId = useId()

  // One parsed pdf.js document shared by every thumbnail in the strip. Without
  // this each tile parses the whole PDF itself, which a long book cannot
  // survive. Dynamically imported for the same reason the rest of this file
  // defers pdf.js: it must never load during SSR.
  useEffect(() => {
    let instance: PdfPageRenderer | null = null
    let cancelled = false

    import('@/lib/services/pdf-service').then(({ PdfPageRenderer }) => {
      if (cancelled) return
      instance = new PdfPageRenderer(pdfBlob)
      setRenderer(instance)
    })

    return () => {
      cancelled = true
      instance?.destroy()
      setRenderer(null)
    }
  }, [pdfBlob])

  // Activating a gap replaces it with a divider bar, so the button that was
  // focused unmounts and focus falls back to <body>. On a long strip that would
  // mean tabbing through every tile again to place a second divider, so hand
  // focus to the new divider's title field instead.
  useEffect(() => {
    if (focusDividerPage === null) return
    stripRef.current
      ?.querySelector<HTMLInputElement>(`[data-divider-title="${focusDividerPage}"]`)
      ?.focus()
    setFocusDividerPage(null)
  }, [focusDividerPage, dividers])

  const sortedDividers = [...dividers].sort((a, b) => a.page - b.page)
  const dividerPages = new Set(sortedDividers.map(d => d.page))

  const labelForLevel = level === 'chapter' ? 'Chapter' : 'Section'

  const handlePageClick = useCallback((pageNumber: number) => {
    if (tocSelectMode) {
      setSelectedTocPages(prev => {
        const next = new Set(prev)
        if (next.has(pageNumber)) next.delete(pageNumber)
        else next.add(pageNumber)
        return next
      })
    }
  }, [tocSelectMode])

  const addDivider = useCallback((afterPage: number) => {
    const dividerPage = afterPage + 1
    if (dividerPage > endPage || dividerPage <= startPage) return
    if (dividerPages.has(dividerPage)) return
    const existingCount = dividers.filter(d => d.page <= dividerPage).length
    setDividers(prev => [
      ...prev,
      { page: dividerPage, title: `${labelForLevel} ${existingCount + 2}` },
    ])
  }, [dividers, dividerPages, endPage, startPage, labelForLevel])

  const removeDivider = useCallback((page: number) => {
    setDividers(prev => prev.filter(d => d.page !== page))
  }, [])

  const updateDividerTitle = useCallback((page: number, title: string) => {
    setDividers(prev => prev.map(d => d.page === page ? { ...d, title } : d))
  }, [])

  const handleExpectedCount = useCallback(() => {
    const count = parseInt(expectedCount)
    if (count > 0 && count < totalBookPages) {
      const pagesPerChapter = Math.ceil((endPage - startPage + 1) / count)
      const newDividers: Divider[] = []
      for (let i = 1; i < count; i++) {
        const page = startPage + i * pagesPerChapter
        if (page <= endPage) {
          newDividers.push({ page, title: `${labelForLevel} ${i + 1}` })
        }
      }
      setDividers(newDividers)
    }
  }, [expectedCount, totalBookPages, endPage, startPage, labelForLevel])

  const handleProcessTOC = useCallback(async () => {
    if (selectedTocPages.size === 0) return
    setProcessing(true)
    setTocError(null)
    try {
      const { StructureService } = await import('@/lib/services/structure-service')
      const svc = new StructureService()
      const data = await svc.suggestFromTOC(bookRemoteId, [...selectedTocPages].sort((a, b) => a - b))
      // Convert suggestions to dividers
      const chapters = data.suggestions?.chapters || data.chapters || []
      const newDividers: Divider[] = []
      for (const ch of chapters) {
        if (ch.startPage && ch.startPage > startPage) {
          newDividers.push({ page: ch.startPage, title: ch.title || `${labelForLevel} ${newDividers.length + 2}` })
        }
      }
      if (newDividers.length === 0) {
        setTocError('No chapters detected in the selected TOC pages. Try selecting different pages.')
        return
      }
      setDividers(newDividers)
      setTocSelectMode(false)
      setSelectedTocPages(new Set())
    } catch (err) {
      console.error('TOC processing failed:', err)
      setTocError(err instanceof Error ? err.message : 'Failed to process TOC')
    } finally {
      setProcessing(false)
    }
  }, [selectedTocPages, bookRemoteId, startPage, labelForLevel])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await onSave(sortedDividers)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save structure')
    } finally {
      setSaving(false)
    }
  }, [onSave, sortedDividers])

  // Build page list with dividers interspersed
  const pages: number[] = []
  for (let p = startPage; p <= endPage; p++) {
    pages.push(p)
  }

  if (endPage < startPage || pages.length === 0) {
    return (
      <div className="flex flex-col gap-4 h-full items-center justify-center py-8">
        <p className="text-muted-foreground text-sm">
          This book has no pages. Upload or process the PDF first before reorganizing chapters.
        </p>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor={expectedCountId} className="text-sm text-muted-foreground">
            Expected count:
          </label>
          <Input
            id={expectedCountId}
            type="number"
            value={expectedCount}
            onChange={e => setExpectedCount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleExpectedCount() }}
            className="w-20 h-8"
            min={1}
          />
        </div>

        <Button
          size="sm"
          variant={tocSelectMode ? 'default' : 'outline'}
          onClick={() => {
            setTocSelectMode(!tocSelectMode)
            if (tocSelectMode) setSelectedTocPages(new Set())
          }}
        >
          Select TOC Pages
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={selectedTocPages.size === 0 || processing}
          onClick={handleProcessTOC}
        >
          {processing ? 'Processing...' : 'Process TOC'}
        </Button>

        <div className="border-l h-6 mx-1" />

        <Button size="sm" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Accept'}
        </Button>
      </div>

      {/* TOC processing error / empty-result message */}
      {tocError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {tocError}
        </div>
      )}

      {/* Strip */}
      <div
        ref={stripRef}
        className="flex items-end gap-0 overflow-x-auto pb-4 pt-2 px-2"
        style={{ minHeight: 180 }}
      >
        {pages.map((page, idx) => {
          const hasDivider = dividerPages.has(page)
          const divider = hasDivider ? sortedDividers.find(d => d.page === page) : null
          const isFirstPage = page === startPage
          const showGapBefore = !isFirstPage && !hasDivider
          const isHoveredGap = hoverGap === page
          const isFocusedGap = focusGap === page

          return (
            <div key={page} className="flex items-end flex-shrink-0">
              {/* Divider bar before this page */}
              {hasDivider && divider && (
                <div className="flex flex-col items-center mx-1 flex-shrink-0">
                  <div className="flex items-center gap-1 mb-1">
                    <input
                      type="text"
                      value={divider.title}
                      onChange={e => updateDividerTitle(page, e.target.value)}
                      className="text-xs bg-transparent border-b border-blue-400 outline-none w-24 text-center text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
                      onClick={e => e.stopPropagation()}
                      data-divider-title={page}
                      aria-label={`${labelForLevel} title for the ${level} starting at page ${page}`}
                    />
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 rounded-sm px-0.5"
                      onClick={() => removeDivider(page)}
                      // The literal "x" text content would otherwise name every
                      // one of these buttons identically.
                      aria-label={`Remove ${level} divider before page ${page}`}
                      title={`Remove ${level} divider before page ${page}`}
                    >
                      x
                    </button>
                  </div>
                  <div className="w-0.5 bg-blue-500 rounded" style={{ height: 140 }} />
                </div>
              )}

              {/* Gap between pages (add divider on click or Enter/Space) */}
              {showGapBefore && (
                <button
                  type="button"
                  className="flex items-center justify-center cursor-pointer mx-0.5 flex-shrink-0 transition-colors rounded focus-visible:ring-2 focus-visible:ring-blue-500"
                  style={{ width: 16, height: 140 }}
                  onMouseEnter={() => setHoverGap(page)}
                  onMouseLeave={() => setHoverGap(null)}
                  onFocus={() => setFocusGap(page)}
                  onBlur={() => setFocusGap(null)}
                  onClick={e => {
                    addDivider(page - 1)
                    // This button unmounts on the next render, and React fires no
                    // blur for that, so the focus flag has to be cleared here or a
                    // gap that reappears after its divider is removed would show a
                    // stuck "+".
                    setFocusGap(null)
                    // detail === 0 means the click came from Enter/Space rather
                    // than a pointer, so this button is about to unmount from
                    // under the keyboard user's focus.
                    if (e.detail === 0) setFocusDividerPage(page)
                  }}
                  aria-label={`Add ${level} divider before page ${page}`}
                  title={`Add ${level} divider before page ${page}`}
                >
                  {(isHoveredGap || isFocusedGap) && (
                    <span className="text-muted-foreground text-lg leading-none">+</span>
                  )}
                </button>
              )}

              {/* Page thumbnail */}
              <PageThumbnail
                renderer={renderer}
                pageNumber={page}
                width={90}
                selectable={tocSelectMode}
                selected={tocSelectMode && selectedTocPages.has(page)}
                onClick={() => handlePageClick(page)}
              />
            </div>
          )
        })}
      </div>

      {/* Error display */}
      {saveError && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {saveError}
        </div>
      )}

      {/* Info bar */}
      <div className="text-xs text-muted-foreground">
        Pages {startPage}-{endPage} | {sortedDividers.length} divider{sortedDividers.length !== 1 ? 's' : ''} = {sortedDividers.length + 1} {level}s
        {tocSelectMode && ` | ${selectedTocPages.size} TOC page${selectedTocPages.size !== 1 ? 's' : ''} selected`}
      </div>
    </div>
  )
}
