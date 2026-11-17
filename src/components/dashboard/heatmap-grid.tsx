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
      <div className="flex flex-wrap gap-[5px]">
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
                  data-state={section.isRead ? 'read' : inProgress ? 'in-progress' : 'unread'}
                  onClick={() => onSectionClick?.(section.id)}
                  aria-label={`${section.title} — ${status}, pages ${section.startPage}-${section.endPage}`}
                  className={`size-4 rounded-[4px] transition-[background-color,transform] duration-150 cursor-pointer outline-none hover:scale-125 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card motion-reduce:hover:scale-100 ${
                    section.isRead
                      ? 'bg-primary hover:bg-primary/80'
                      : inProgress
                        ? 'bg-highlight hover:bg-highlight/80'
                        : 'bg-foreground/10 hover:bg-foreground/20'
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
