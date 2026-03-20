'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ChapterWithSections } from '@/hooks/use-book-detail'
import type { Divider } from '@/components/editor/page-strip-editor'

interface ChapterAccordionProps {
  bookId: string
  chapters: ChapterWithSections[]
  pdfBlob?: Blob
  bookRemoteId?: string
  totalBookPages?: number
  searchQuery?: string
}

interface ChapterGroup {
  title: string
  chapters: ChapterWithSections[]
  progress: { read: number; total: number; percentage: number }
}

export function ChapterAccordion({ bookId, chapters, pdfBlob, bookRemoteId, totalBookPages, searchQuery }: ChapterAccordionProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null)
  const [dividingChapter, setDividingChapter] = useState<ChapterWithSections | null>(null)

  const query = (searchQuery || '').trim().toLowerCase()
  const isSearching = query.length > 0
  // Group chapters by their prefix (Part > Chapter structure)
  // "Part 1 > Chapter 2" → group "Part 1", child "Chapter 2"
  // "Preface" (no >) → standalone group
  const groups = useMemo(() => {
    const groupMap = new Map<string, ChapterWithSections[]>()

    for (const ch of chapters) {
      const sepIdx = ch.title.indexOf(' > ')
      if (sepIdx > 0) {
        const groupTitle = ch.title.substring(0, sepIdx)
        const existing = groupMap.get(groupTitle) || []
        // Create a copy with the shortened title
        existing.push({
          ...ch,
          title: ch.title.substring(sepIdx + 3), // strip "Part 1 > " prefix
        })
        groupMap.set(groupTitle, existing)
      } else {
        // Standalone chapter (no >)
        groupMap.set(ch.title, [ch])
      }
    }

    const result: ChapterGroup[] = []
    for (const [title, chs] of groupMap) {
      const read = chs.reduce((sum, c) => sum + c.progress.read, 0)
      const total = chs.reduce((sum, c) => sum + c.progress.total, 0)
      result.push({
        title,
        chapters: chs,
        progress: { read, total, percentage: total > 0 ? Math.round((read / total) * 100) : 0 },
      })
    }
    return result
  }, [chapters])

  // If no nesting needed (no > in any title), render flat like before
  const hasNesting = groups.some(g => g.chapters.length > 1 || g.chapters[0]?.title !== g.title)
  const handleSaveSections = useCallback(async (chapter: ChapterWithSections, dividers: Divider[]) => {
    if (!bookRemoteId || !totalBookPages) return
    const { StructureService } = await import('@/lib/services/structure-service')
    const svc = new StructureService()

    // Build sections for this chapter from dividers
    const sorted = [...dividers].sort((a, b) => a.page - b.page)
    const sections: Array<{ title: string; startPage: number; endPage: number }> = []
    let cs = chapter.startPage
    for (let i = 0; i < sorted.length; i++) {
      sections.push({
        title: i === 0 ? 'Section 1' : sorted[i - 1].title,
        startPage: cs,
        endPage: sorted[i].page - 1,
      })
      cs = sorted[i].page
    }
    sections.push({
      title: sorted.length > 0 ? sorted[sorted.length - 1].title : 'Section 1',
      startPage: cs,
      endPage: chapter.endPage,
    })

    // Build full book structure with sections for this chapter
    const fullChapters = chapters.map(ch => {
      const base = { title: ch.title, startPage: ch.startPage, endPage: ch.endPage }
      if (ch.id === chapter.id) {
        return { ...base, sections }
      }
      // Preserve existing sections for other chapters
      if (ch.sections.length > 0) {
        return {
          ...base,
          sections: ch.sections.map(s => ({ title: s.title, startPage: s.startPage, endPage: s.endPage })),
        }
      }
      return base
    })

    await svc.saveStructure(bookRemoteId, fullChapters)
    const { syncService } = await import('@/lib/services/sync-service')
    syncService.markDirty()
    await syncService.sync()
    setDividingChapter(null)
    // Trigger a page refresh
    window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
  }, [bookRemoteId, totalBookPages, chapters])
  const divideDialog = dividingChapter && pdfBlob && bookRemoteId && totalBookPages ? (() => {
    const PageStripEditor = require('@/components/editor/page-strip-editor').PageStripEditor
    const existingDividers: Divider[] = dividingChapter.sections
      .filter(s => s.startPage > dividingChapter.startPage)
      .map(s => ({ page: s.startPage, title: s.title }))

    return (
      <Dialog open={!!dividingChapter} onOpenChange={(open) => { if (!open) setDividingChapter(null) }}>
        <DialogContent className="max-w-[95vw] max-h-[80vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Divide Sections: {dividingChapter.title}</DialogTitle>
          </DialogHeader>
          <PageStripEditor
            pdfBlob={pdfBlob}
            startPage={dividingChapter.startPage}
            endPage={dividingChapter.endPage}
            totalBookPages={totalBookPages}
            bookRemoteId={bookRemoteId}
            existingDividers={existingDividers}
            level="section"
            onSave={async (dividers: Divider[]) => {
              await handleSaveSections(dividingChapter, dividers)
            }}
            onClose={() => setDividingChapter(null)}
          />
        </DialogContent>
      </Dialog>
    )
  })() : null

  // Filter chapters based on search query
  const filteredChapters = useMemo(() => {
    if (!isSearching) return chapters
    return chapters.filter(ch => {
      const chapterMatches = ch.title.toLowerCase().includes(query)
      const sectionMatches = ch.sections.some(s => s.title.toLowerCase().includes(query))
      return chapterMatches || sectionMatches
    })
  }, [chapters, query, isSearching])

  if (!hasNesting) {
    // Flat rendering (no groups)
    return (
      <div className="space-y-2">
        {filteredChapters.map(chapter => (
          <FlatChapter key={chapter.id} bookId={bookId} chapter={chapter}
            expanded={isSearching || expandedChapter === chapter.id}
            onToggle={() => setExpandedChapter(expandedChapter === chapter.id ? null : chapter.id)}
            canDivide={!!pdfBlob && !!bookRemoteId}
            onDivide={() => setDividingChapter(chapter)}
            searchQuery={query}
          />
        ))}
        {filteredChapters.length === 0 && isSearching && (
          <p className="text-sm text-muted-foreground py-4 text-center">No chapters or sections match your search.</p>
        )}
        {divideDialog}
      </div>
    )
  }
  // Filter groups for search
  const filteredGroups = useMemo(() => {
    if (!isSearching) return groups
    return groups
      .map(group => {
        const filteredChs = group.chapters.filter(ch => {
          const chapterMatches = ch.title.toLowerCase().includes(query)
          const sectionMatches = ch.sections.some(s => s.title.toLowerCase().includes(query))
          return chapterMatches || sectionMatches
        })
        if (filteredChs.length === 0 && !group.title.toLowerCase().includes(query)) return null
        const read = filteredChs.reduce((sum, c) => sum + c.progress.read, 0)
        const total = filteredChs.reduce((sum, c) => sum + c.progress.total, 0)
        return {
          ...group,
          chapters: filteredChs.length > 0 ? filteredChs : group.chapters,
          progress: filteredChs.length > 0 ? { read, total, percentage: total > 0 ? Math.round((read / total) * 100) : 0 } : group.progress,
        }
      })
      .filter((g): g is ChapterGroup => g !== null)
  }, [groups, query, isSearching])
  // Nested rendering (groups > chapters > sections)
  return (
    <div className="space-y-2">
      {divideDialog}
      {filteredGroups.map(group => {
        const isGroupExpanded = isSearching || expandedGroup === group.title
        const isSingleChapter = group.chapters.length === 1 && group.chapters[0].title === group.title

        if (isSingleChapter) {
          // Standalone chapter — render flat
          return (
            <FlatChapter key={group.title} bookId={bookId} chapter={group.chapters[0]}
              expanded={isSearching || expandedChapter === group.chapters[0].id}
              onToggle={() => setExpandedChapter(expandedChapter === group.chapters[0].id ? null : group.chapters[0].id)}
              canDivide={!!pdfBlob && !!bookRemoteId}
              onDivide={() => setDividingChapter(group.chapters[0])}
              searchQuery={query}
            />
          )
        }

        return (
          <div key={group.title} className="border rounded-lg">
            {/* Group header */}
            <button
              onClick={() => setExpandedGroup(isGroupExpanded ? null : group.title)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs transition-transform ${isGroupExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                <span className="text-sm font-semibold">{group.title}</span>
                <Badge variant="outline" className="text-xs">
                  {group.progress.read}/{group.progress.total}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <Progress value={group.progress.percentage} className="w-24 h-2" />
                <span className="text-xs text-muted-foreground w-8">{group.progress.percentage}%</span>
              </div>
            </button>

            {/* Child chapters */}
            {isGroupExpanded && (
              <div className="px-3 pb-3 space-y-1">
                {group.chapters.map(chapter => (
                  <FlatChapter key={chapter.id} bookId={bookId} chapter={chapter} nested
                    expanded={isSearching || expandedChapter === chapter.id}
                    onToggle={() => setExpandedChapter(expandedChapter === chapter.id ? null : chapter.id)}
                    canDivide={!!pdfBlob && !!bookRemoteId}
                    onDivide={() => setDividingChapter(chapter)}
                    searchQuery={query}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
      {filteredGroups.length === 0 && isSearching && (
        <p className="text-sm text-muted-foreground py-4 text-center">No chapters or sections match your search.</p>
      )}
    </div>
  )
}

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.substring(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">{text.substring(idx, idx + query.length)}</mark>
      {text.substring(idx + query.length)}
    </>
  )
}

function FlatChapter({ bookId, chapter, expanded, onToggle, nested, canDivide, onDivide, searchQuery }: {
  bookId: string
  chapter: ChapterWithSections
  expanded: boolean
  onToggle: () => void
  nested?: boolean
  canDivide?: boolean
  onDivide?: () => void
  searchQuery?: string
}) {
  const isSearching = !!searchQuery
  // When searching, only show matching sections (or all sections if the chapter title itself matches)
  const visibleSections = useMemo(() => {
    if (!searchQuery) return chapter.sections
    const chapterTitleMatches = chapter.title.toLowerCase().includes(searchQuery)
    if (chapterTitleMatches) return chapter.sections
    return chapter.sections.filter(s => s.title.toLowerCase().includes(searchQuery))
  }, [chapter, searchQuery])

  return (
    <div className={`border rounded-lg ${nested ? 'border-border/50' : ''}`}>
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex-1 flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
            <span className={`text-sm ${nested ? '' : 'font-medium'}`}>
              {isSearching ? <HighlightText text={chapter.title} query={searchQuery} /> : chapter.title}
            </span>
            <Badge variant="outline" className="text-xs">
              {chapter.progress.read}/{chapter.progress.total}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <Progress value={chapter.progress.percentage} className="w-24 h-2" />
            <span className="text-xs text-muted-foreground w-8">{chapter.progress.percentage}%</span>
          </div>
        </button>
        {canDivide && onDivide && (
          <Button
            size="xs"
            variant="ghost"
            className="mr-2 text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); onDivide() }}
            title="Divide into sections"
          >
            Divide
          </Button>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {visibleSections.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No sections yet.</p>
          ) : (
            visibleSections.map(section => (
              <Link
                key={section.id}
                href={`/book/${bookId}/read/${section.id}`}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${section.isRead ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                  <span className="text-sm">
                    {isSearching ? <HighlightText text={section.title} query={searchQuery} /> : section.title}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">p.{section.startPage}-{section.endPage}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  )
}
