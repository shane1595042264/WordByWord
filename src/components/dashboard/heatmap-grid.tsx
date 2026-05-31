'use client'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Section } from '@/lib/db/models'

interface HeatmapGridProps {
  sections: Section[]
  onSectionClick?: (sectionId: string) => void
}

export function HeatmapGrid({ sections, onSectionClick }: HeatmapGridProps) {
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
}
