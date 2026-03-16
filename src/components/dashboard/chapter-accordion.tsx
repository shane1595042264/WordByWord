'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import type { ChapterWithSections } from '@/hooks/use-book-detail'

interface ChapterAccordionProps {
  bookId: string
  chapters: ChapterWithSections[]
}

interface ChapterGroup {
  title: string
  chapters: ChapterWithSections[]
  progress: { read: number; total: number; percentage: number }
}

export function ChapterAccordion({ bookId, chapters }: ChapterAccordionProps) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [expandedChapter, setExpandedChapter] = useState<string | null>(null)

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

  if (!hasNesting) {
    // Flat rendering (no groups)
    return (
      <div className="space-y-2">
        {chapters.map(chapter => (
          <FlatChapter key={chapter.id} bookId={bookId} chapter={chapter}
            expanded={expandedChapter === chapter.id}
            onToggle={() => setExpandedChapter(expandedChapter === chapter.id ? null : chapter.id)}
          />
        ))}
      </div>
    )
  }

  // Nested rendering (groups > chapters > sections)
  return (
    <div className="space-y-2">
      {groups.map(group => {
        const isGroupExpanded = expandedGroup === group.title
        const isSingleChapter = group.chapters.length === 1 && group.chapters[0].title === group.title

        if (isSingleChapter) {
          // Standalone chapter — render flat
          return (
            <FlatChapter key={group.title} bookId={bookId} chapter={group.chapters[0]}
              expanded={expandedChapter === group.chapters[0].id}
              onToggle={() => setExpandedChapter(expandedChapter === group.chapters[0].id ? null : group.chapters[0].id)}
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
                    expanded={expandedChapter === chapter.id}
                    onToggle={() => setExpandedChapter(expandedChapter === chapter.id ? null : chapter.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FlatChapter({ bookId, chapter, expanded, onToggle, nested }: {
  bookId: string
  chapter: ChapterWithSections
  expanded: boolean
  onToggle: () => void
  nested?: boolean
}) {
  return (
    <div className={`border rounded-lg ${nested ? 'border-border/50' : ''}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
          <span className={`text-sm ${nested ? '' : 'font-medium'}`}>{chapter.title}</span>
          <Badge variant="outline" className="text-xs">
            {chapter.progress.read}/{chapter.progress.total}
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          <Progress value={chapter.progress.percentage} className="w-24 h-2" />
          <span className="text-xs text-muted-foreground w-8">{chapter.progress.percentage}%</span>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {chapter.sections.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No sections yet.</p>
          ) : (
            chapter.sections.map(section => (
              <Link
                key={section.id}
                href={`/book/${bookId}/read/${section.id}`}
                className="flex items-center justify-between py-2 px-3 rounded hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${section.isRead ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
                  <span className="text-sm">{section.title}</span>
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
