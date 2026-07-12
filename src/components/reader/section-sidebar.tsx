'use client'

import Link from 'next/link'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Section } from '@/lib/db/models'

interface SectionSidebarProps {
  bookId: string
  sections: Section[]
  currentSectionId: string
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export function SectionSidebar({ bookId, sections, currentSectionId, collapsed, onToggleCollapse }: SectionSidebarProps) {
  if (collapsed) {
    return (
      <div className="h-full border-r flex flex-col items-center py-2 w-10 flex-shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
          title="Expand sidebar (Ctrl+[)"
          aria-label="Expand sidebar"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 4 10 8 6 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full w-64 border-r flex-shrink-0">
      <div className="p-4 space-y-1">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Sections</h3>
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="Collapse sidebar (Ctrl+[)"
            aria-label="Collapse sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="10 4 6 8 10 12" />
            </svg>
          </button>
        </div>
        {sections.map(section => (
          <Link
            key={section.id}
            href={`/book/${bookId}/read/${section.id}`}
            aria-current={section.id === currentSectionId ? 'page' : undefined}
            className={`flex items-center gap-2 py-2 px-3 rounded text-sm transition-colors ${
              section.id === currentSectionId
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            }`}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              section.isRead ? 'bg-green-500' : 'bg-muted-foreground/30'
            }`} aria-hidden="true" />
            <span className="sr-only">{section.isRead ? 'Read: ' : 'Unread: '}</span>
            <span className="truncate">{section.title}</span>
          </Link>
        ))}
      </div>
    </ScrollArea>
  )
}
