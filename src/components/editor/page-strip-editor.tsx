'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageThumbnail } from './page-thumbnail'

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
  const [hoverGap, setHoverGap] = useState<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

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
      setDividers(newDividers)
      setTocSelectMode(false)
      setSelectedTocPages(new Set())
    } catch (err) {
      console.error('TOC processing failed:', err)
    } finally {
      setProcessing(false)
    }
  }, [selectedTocPages, bookRemoteId, startPage, labelForLevel])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(sortedDividers)
    } finally {
      setSaving(false)
    }
  }, [onSave, sortedDividers])

  // Build page list with dividers interspersed
  const pages: number[] = []
  for (let p = startPage; p <= endPage; p++) {
    pages.push(p)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Expected count:</span>
          <Input
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
                      className="text-xs bg-transparent border-b border-blue-400 outline-none w-24 text-center text-blue-600"
                      onClick={e => e.stopPropagation()}
                    />
                    <button
                      type="button"
                      className="text-xs text-red-400 hover:text-red-600"
                      onClick={() => removeDivider(page)}
                      title="Remove divider"
                    >
                      x
                    </button>
                  </div>
                  <div className="w-0.5 bg-blue-500 rounded" style={{ height: 140 }} />
                </div>
              )}

              {/* Gap between pages (add divider on click) */}
              {showGapBefore && (
                <div
                  className="flex items-center justify-center cursor-pointer mx-0.5 flex-shrink-0 transition-colors"
                  style={{ width: 16, height: 140 }}
                  onMouseEnter={() => setHoverGap(page)}
                  onMouseLeave={() => setHoverGap(null)}
                  onClick={() => addDivider(page - 1)}
                  title={`Add ${level} divider before page ${page}`}
                >
                  {isHoveredGap && (
                    <span className="text-muted-foreground text-lg leading-none">+</span>
                  )}
                </div>
              )}

              {/* Page thumbnail */}
              <PageThumbnail
                pdfBlob={pdfBlob}
                pageNumber={page}
                width={90}
                selected={tocSelectMode && selectedTocPages.has(page)}
                onClick={() => handlePageClick(page)}
              />
            </div>
          )
        })}
      </div>

      {/* Info bar */}
      <div className="text-xs text-muted-foreground">
        Pages {startPage}-{endPage} | {sortedDividers.length} divider{sortedDividers.length !== 1 ? 's' : ''} = {sortedDividers.length + 1} {level}s
        {tocSelectMode && ` | ${selectedTocPages.size} TOC page${selectedTocPages.size !== 1 ? 's' : ''} selected`}
      </div>
    </div>
  )
}
