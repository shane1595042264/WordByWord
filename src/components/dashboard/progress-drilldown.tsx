'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { HeatmapGrid } from './heatmap-grid'
import { ChapterAccordion } from './chapter-accordion'
import type { BookDetail } from '@/hooks/use-book-detail'

interface ProgressDrilldownProps {
  book: BookDetail
  onReorganize?: () => void
}

export function ProgressDrilldown({ book, onReorganize }: ProgressDrilldownProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClear = useCallback(() => {
    setSearchQuery('')
    inputRef.current?.focus()
  }, [])

  // Count matching chapters/sections for search feedback
  const matchCount = useMemo(() => {
    if (!searchQuery.trim()) return null
    const q = searchQuery.trim().toLowerCase()
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
  }, [searchQuery, book.chapters])

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">Overall Progress</span>
          <span className="text-muted-foreground">
            {book.progress.read}/{book.progress.total} sections ({book.progress.percentage}%)
          </span>
        </div>
        <Progress value={book.progress.percentage} className={`h-3 ${book.completedAt ? '[&_[data-slot=progress-indicator]]:bg-green-500' : ''}`} />
        {book.completedAt && (
          <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
            <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
            </div>
            <span className="text-sm font-medium">
              Completed on {new Date(book.completedAt).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Reading Heatmap</h3>
        <HeatmapGrid sections={book.allSections} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Chapters</h3>
          {onReorganize && (
            <Button size="xs" variant="outline" onClick={onReorganize}>
              Reorganize Chapters
            </Button>
          )}
        </div>

        {/* Search bar */}
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            aria-label="Search chapters and sections"
            placeholder="Search chapters and sections..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm border rounded-md bg-background outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 placeholder:text-muted-foreground"
          />
          {searchQuery && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              title="Clear search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
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
          searchQuery={searchQuery}
        />
      </div>
    </div>
  )
}
