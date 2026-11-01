'use client'

import { memo } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Section } from '@/lib/db/models'

interface HeatmapGridProps {
  sections: Section[]
  onSectionClick?: (sectionId: string) => void
}

// Memoized: one Radix Tooltip per section adds up (657 on the largest book), and
// typing in the sibling search box re-renders this subtree for no reason. Both props
// are referentially stable unless the book data actually reloads.
export const HeatmapGrid = memo(function HeatmapGrid({ sections, onSectionClick }: HeatmapGridProps) {
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1">
        {sections.map(section => {
          // Same three states as the chapter list below (chapter-accordion.tsx): isRead wins,
          // otherwise any scroll progress means the section was started.
          const inProgress = !section.isRead && section.scrollProgress != null && section.scrollProgress > 0
          const status = section.isRead
            ? 'Read'
            : inProgress
              ? `In progress (${Math.round(section.scrollProgress!)}%)`
              : 'Unread'
          return (
            <Tooltip key={section.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSectionClick?.(section.id)}
                  aria-label={`${section.title} — ${status}, pages ${section.startPage}-${section.endPage}`}
                  className={`w-4 h-4 rounded-sm transition-colors cursor-pointer ${
                    section.isRead
                      ? 'bg-green-500 hover:bg-green-400'
                      : inProgress
                        ? 'bg-yellow-500 hover:bg-yellow-400'
                        : 'bg-muted hover:bg-muted-foreground/20'
                  }`}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{section.title}</p>
                <p className="text-xs text-muted-foreground">
                  {status} — Pages {section.startPage}-{section.endPage}
                </p>
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
})
