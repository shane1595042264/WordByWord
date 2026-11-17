'use client'

import { useState, useMemo, useCallback, useRef, useDeferredValue } from 'react'
import { useRouter } from 'next/navigation'
import { CheckIcon, SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HeatmapGrid } from './heatmap-grid'
import { ChapterAccordion } from './chapter-accordion'
import type { BookDetail } from '@/hooks/use-book-detail'

interface ProgressDrilldownProps {
  book: BookDetail
  onReorganize?: () => void
}

export function ProgressDrilldown({ book, onReorganize }: ProgressDrilldownProps) {
  const [searchQuery, setSearchQuery] = useState('')
  // The input stays bound to searchQuery so typing is instant; the expensive filtered
  // chapter tree and match count read the deferred value and catch up at lower priority.
  const deferredQuery = useDeferredValue(searchQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleClear = useCallback(() => {
    setSearchQuery('')
    inputRef.current?.focus()
  }, [])

  const handleSectionClick = useCallback(
    (sectionId: string) => {
      router.push(`/book/${book.id}/read/${sectionId}`)
    },
    [router, book.id]
  )

  // Count matching chapters/sections for search feedback
  const matchCount = useMemo(() => {
    if (!deferredQuery.trim()) return null
    const q = deferredQuery.trim().toLowerCase()
    let chapters = 0
    let sections = 0
    for (const ch of book.chapters) {
      const chapterMatches = ch.title.toLowerCase().includes(q)
      const matchingSections = ch.sections.filter(s => s.title.toLowerCase().includes(q))
      if (chapterMatches || matchingSections.length > 0) {
        chapters++
        sections += matchingSections.length
      }
    }
    return { chapters, sections }
  }, [deferredQuery, book.chapters])

  return (
    <div className="space-y-12">
      {book.completedAt && (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-accent px-4 py-3 text-accent-foreground">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />
          </span>
          <span className="text-sm font-medium">
            Completed on {new Date(book.completedAt).toLocaleDateString()}
          </span>
        </div>
      )}

      <section aria-labelledby="reading-map-heading" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 id="reading-map-heading" className="font-display text-xl font-semibold tracking-tight">Reading map</h2>
          <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] bg-primary" />Read</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] bg-highlight" />In progress</li>
            <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[3px] bg-foreground/10" />Unread</li>
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <HeatmapGrid sections={book.allSections} onSectionClick={handleSectionClick} />
        </div>
        <p className="sr-only">
          {book.progress.read} of {book.progress.total} sections read ({book.progress.percentage}%)
        </p>
      </section>

      <section aria-labelledby="chapters-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <h2 id="chapters-heading" className="font-display text-xl font-semibold tracking-tight">Chapters</h2>
          {onReorganize && (
            <Button size="sm" variant="outline" onClick={onReorganize}>
              Reorganize Chapters
            </Button>
          )}
        </div>

        {/* Search bar */}
        <div className="relative">
          <SearchIcon aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search chapters and sections"
            placeholder="Search chapters and sections..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-card pl-9 pr-9 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
          />
          {searchQuery && (
            <button
              onClick={handleClear}
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
              title="Clear search"
            >
              <XIcon aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </div>

        {/* Search result count */}
        {matchCount && (
          <p className="text-xs text-muted-foreground">
            {matchCount.chapters === 0 && matchCount.sections === 0
              ? 'No matches found'
              : `Found ${matchCount.chapters} chapter${matchCount.chapters !== 1 ? 's' : ''} and ${matchCount.sections} section${matchCount.sections !== 1 ? 's' : ''}`}
          </p>
        )}

        <ChapterAccordion
          bookId={book.id}
          chapters={book.chapters}
          pdfBlob={book.pdfBlob}
          bookRemoteId={book.remoteId}
          totalBookPages={book.totalPages}
          searchQuery={deferredQuery}
        />
      </section>
    </div>
  )
}
