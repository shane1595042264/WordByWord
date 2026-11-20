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

interface TocEntry {
  title?: string
  startPage?: number
  sections?: TocEntry[]
}

interface TocSuggestionData {
  suggestions?: { chapters?: TocEntry[] }
  chapters?: TocEntry[]
  pageOffset?: number
}

/** The server's guess at printed-page-1's distance from PDF page 1 (KAN-410). */
export function tocPageOffset(data: TocSuggestionData | null | undefined): number {
  const offset = data?.pageOffset
  return typeof offset === 'number' && Number.isInteger(offset) ? offset : 0
}

// Turn a /suggest-structure response into dividers for the strip's page range.
// The AI reads the whole book's TOC, so entries routinely start outside the range
// (every later chapter, when dividing one chapter into sections) or repeat a page.
// A divider past endPage has no bar to remove and a repeated page yields a
// startPage > endPage segment, both of which the structure PUT rejects (KAN-388).
// Keep integer starts in (startPage, endPage], first title per page, ascending.
// Divide Sections also looks at each chapter's nested sections, since those are
// the starts that fall inside a chapter.
// The TOC's page numbers are the book's printed ones, so each start is shifted by
// pageOffset (front-matter pages before printed page 1) into a PDF page BEFORE the
// range filter; filtering first drops the very starts the shift would bring in (KAN-410).
export function dividersFromTocSuggestion(
  data: TocSuggestionData | null | undefined,
  startPage: number,
  endPage: number,
  level: 'chapter' | 'section',
  pageOffset = 0
): Divider[] {
  const chapters = data?.suggestions?.chapters || data?.chapters || []
  const entries: TocEntry[] = []
  for (const ch of chapters) {
    entries.push(ch)
    if (level === 'section' && Array.isArray(ch.sections)) entries.push(...ch.sections)
  }

  const byPage = new Map<number, string>()
  for (const entry of entries) {
    if (typeof entry.startPage !== 'number' || !Number.isInteger(entry.startPage)) continue
    const page = entry.startPage + pageOffset
    if (page <= startPage || page > endPage || byPage.has(page)) continue
    byPage.set(page, entry.title || '')
  }

  const labelForLevel = level === 'chapter' ? 'Chapter' : 'Section'
  return [...byPage.keys()]
    .sort((a, b) => a - b)
    .map((page, i) => ({ page, title: byPage.get(page) || `${labelForLevel} ${i + 2}` }))
}

// Split [startPage, endPage] into `count` parts of near-equal size (they differ by
// at most one page). Stepping by the exact fraction rather than a rounded-up step
// keeps every divider inside the range, so count N always yields N parts (KAN-412).
// A count above the range's page count is capped at one part per page.
export function dividersForExpectedCount(
  count: number,
  startPage: number,
  endPage: number,
  level: 'chapter' | 'section'
): Divider[] {
  const range = endPage - startPage + 1
  const parts = Math.min(count, range)
  const labelForLevel = level === 'chapter' ? 'Chapter' : 'Section'
  const dividers: Divider[] = []
  for (let i = 1; i < parts; i++) {
    dividers.push({ page: startPage + Math.round((i * range) / parts), title: `${labelForLevel} ${i + 1}` })
  }
  return dividers
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
  // Last Process TOC result, kept so the printed-page-1 field can re-place the
  // dividers without another AI call.
  const [tocResult, setTocResult] = useState<TocSuggestionData | null>(null)
  const [pageOneInput, setPageOneInput] = useState('1')
  const [hoverGap, setHoverGap] = useState<number | null>(null)
  const [focusGap, setFocusGap] = useState<number | null>(null)
  // Page of a divider that was just added from the keyboard and should receive
  // focus once it renders. See the gap button's onClick for why this is needed.
  const [focusDividerPage, setFocusDividerPage] = useState<number | null>(null)
  const [renderer, setRenderer] = useState<PdfPageRenderer | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const expectedCountId = useId()
  const pageOneId = useId()

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
    if (!(count > 0)) return
    // Show the cap instead of quietly producing fewer parts than typed.
    const range = endPage - startPage + 1
    if (count > range) setExpectedCount(String(range))
    setDividers(dividersForExpectedCount(count, startPage, endPage, level))
  }, [expectedCount, endPage, startPage, level])

  const handleProcessTOC = useCallback(async () => {
    if (selectedTocPages.size === 0) return
    setProcessing(true)
    setTocError(null)
    try {
      const { StructureService } = await import('@/lib/services/structure-service')
      const svc = new StructureService()
      const data = await svc.suggestFromTOC(bookRemoteId, [...selectedTocPages].sort((a, b) => a - b))
      const offset = tocPageOffset(data)
      setTocResult(data)
      setPageOneInput(String(offset + 1))
      const newDividers = dividersFromTocSuggestion(data, startPage, endPage, level, offset)
      if (newDividers.length === 0) {
        setTocError(`No ${level === 'chapter' ? 'chapters' : 'sections'} detected in the selected TOC pages. Try selecting different pages.`)
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
  }, [selectedTocPages, bookRemoteId, startPage, endPage, level])

  const handlePageOneChange = useCallback((value: string) => {
    setPageOneInput(value)
    const pdfPage = parseInt(value)
    if (!tocResult || !Number.isInteger(pdfPage) || pdfPage < 1) return
    setDividers(dividersFromTocSuggestion(tocResult, startPage, endPage, level, pdfPage - 1))
  }, [tocResult, startPage, endPage, level])

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
    <div className="flex flex-col gap-4 h-full min-w-0">
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
            max={endPage - startPage + 1}
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

        {tocResult && (
          <div className="flex items-center gap-2">
            <label htmlFor={pageOneId} className="text-sm text-muted-foreground">
              Printed page 1 = PDF page
            </label>
            <Input
              id={pageOneId}
              type="number"
              value={pageOneInput}
              onChange={e => handlePageOneChange(e.target.value)}
              className="w-20 h-8"
              min={1}
              max={totalBookPages}
            />
          </div>
        )}

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
