'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { BlockTooltip } from '@/components/ui/block-tooltip'
import type { ViewMode } from '@/hooks/use-reader'

interface ReaderToolbarProps {
  bookId: string
  sectionTitle: string
  isRead: boolean
  sectionId: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  readingMode: 'scroll' | 'flip'
  onReadingModeChange: (mode: 'scroll' | 'flip') => void
  onReadToggle: () => void
  sectionProgress: number
  showIndicators?: boolean
  onToggleIndicators?: () => void
  /** Page-level navigation */
  currentPage: number
  totalSectionPages: number
  startPage: number
  onPrevPage: () => void
  onNextPage: () => void
  canGoPrev: boolean
  canGoNext: boolean
}

export function ReaderToolbar({
  bookId, sectionTitle, isRead, sectionId,
  viewMode, onViewModeChange,
  readingMode, onReadingModeChange,
  onReadToggle,
  sectionProgress,
  showIndicators, onToggleIndicators,
  currentPage, totalSectionPages, startPage,
  onPrevPage, onNextPage, canGoPrev, canGoNext,
}: ReaderToolbarProps) {
  const handleToggleRead = async () => {
    const { SectionRepository } = await import('@/lib/repositories')
    const sectionRepo = new SectionRepository()
    if (isRead) {
      await sectionRepo.markAsUnread(sectionId)
    } else {
      await sectionRepo.markAsRead(sectionId)
    }
    onReadToggle()
  }

  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <BlockTooltip label="Back to Dashboard" shortcut="⌃ B">
            <Link href={`/book/${bookId}`}>
              <Button variant="ghost" size="sm">&larr; Dashboard</Button>
            </Link>
          </BlockTooltip>
          <span className="text-sm font-medium truncate max-w-[200px]">{sectionTitle}</span>
          <BlockTooltip label={isRead ? 'Mark as Unread' : 'Mark as Read'} shortcut="⌃ R">
            <Badge
              variant={isRead ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={handleToggleRead}
            >
              {isRead ? 'Read' : 'Mark as Read'}
            </Badge>
          </BlockTooltip>
        </div>
        <div className="flex items-center gap-2">
          {/* .nib element indicator toggle */}
          <BlockTooltip label="Toggle Element Labels" shortcut="⌃ I" hint="Show/hide paragraph, header, section indicators">
            <button
              onClick={onToggleIndicators}
              className={`px-3 py-1 text-xs border rounded-md transition-colors ${
                showIndicators
                  ? 'bg-amber-500/20 text-amber-600 border-amber-500/30'
                  : 'hover:bg-muted'
              }`}
            >
              {showIndicators ? '⊟ Labels' : '⊞ Labels'}
            </button>
          </BlockTooltip>
          {/* View mode toggle */}
          <div className="flex border rounded-md">
            {(['pdf', 'text', 'side-by-side'] as ViewMode[]).map(mode => {
              const shortcutMap: Record<string, string> = { pdf: '⌃ 1', text: '⌃ 2', 'side-by-side': '⌃ 3' }
              return (
                <BlockTooltip key={mode} label={mode} shortcut={shortcutMap[mode]}>
                  <button
                    onClick={() => onViewModeChange(mode)}
                    className={`px-3 py-1 text-xs capitalize ${
                      viewMode === mode ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    {mode}
                  </button>
                </BlockTooltip>
              )
            })}
          </div>
          {/* Reading mode toggle (scroll vs flip) - only for PDF modes */}
          {viewMode !== 'text' && (
            <div className="flex border rounded-md">
              <BlockTooltip label="Scroll Mode" shortcut="⌃ S">
                <button
                  onClick={() => onReadingModeChange('scroll')}
                  className={`px-3 py-1 text-xs ${
                    readingMode === 'scroll' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  Scroll
                </button>
              </BlockTooltip>
              <BlockTooltip label="Flip Mode" shortcut="⌃ F">
                <button
                  onClick={() => onReadingModeChange('flip')}
                  className={`px-3 py-1 text-xs ${
                    readingMode === 'flip' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  Flip
                </button>
              </BlockTooltip>
            </div>
          )}
          {/* Page nav */}
          <div className="flex items-center gap-2">
            <BlockTooltip label="Previous Page" shortcut="⌃ ←">
              <Button variant="outline" size="sm" onClick={onPrevPage} disabled={!canGoPrev}>
                &larr; Prev
              </Button>
            </BlockTooltip>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {currentPage - startPage + 1}/{totalSectionPages} (p.{currentPage})
            </span>
            <BlockTooltip label="Next Page" shortcut="⌃ →">
              <Button variant="outline" size="sm" onClick={onNextPage} disabled={!canGoNext}>
                Next &rarr;
              </Button>
            </BlockTooltip>
          </div>
        </div>
      </div>
      {/* Section progress bar */}
      <Progress value={sectionProgress} className="h-1 rounded-none" />
    </div>
  )
}
