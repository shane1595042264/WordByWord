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
        {sections.map(section => (
          <Tooltip key={section.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSectionClick?.(section.id)}
                aria-label={`${section.title} — ${section.isRead ? 'Read' : 'Unread'}, pages ${section.startPage}-${section.endPage}`}
                className={`w-4 h-4 rounded-sm transition-colors cursor-pointer ${
                  section.isRead
                    ? 'bg-green-500 hover:bg-green-400'
                    : 'bg-muted hover:bg-muted-foreground/20'
                }`}
              />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">{section.title}</p>
              <p className="text-xs text-muted-foreground">
                {section.isRead ? 'Read' : 'Unread'} — Pages {section.startPage}-{section.endPage}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
})
