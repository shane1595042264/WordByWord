'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BlockTooltip } from '@/components/ui/block-tooltip'
import { useShortcut, useShortcuts } from '@/hooks/use-shortcuts'
import type { ViewMode } from '@/hooks/use-reader'

interface ReaderToolbarProps {
  bookId: string
  bookTitle?: string
  sectionTitle: string
  isRead: boolean
  sectionId: string
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  readingMode: 'scroll' | 'flip'
  onReadingModeChange: (mode: 'scroll' | 'flip') => void
  onReadToggle: (bookJustCompleted?: boolean) => void
  sectionProgress: number
  showIndicators?: boolean
  onToggleIndicators?: () => void
  /** Sync scroll toggle for side-by-side scroll mode */
  syncScroll?: boolean
  onSyncScrollChange?: (sync: boolean) => void
  /** Page-level navigation */
  currentPage: number
  totalSectionPages: number
  startPage: number
  onPrevPage: () => void
  onNextPage: () => void
  canGoPrev: boolean
  canGoNext: boolean
  /** Line numbers toggle */
  showLineNumbers?: boolean
  onLineNumbersToggle?: () => void
  /** Sidebar collapse toggle */
  sidebarCollapsed?: boolean
  onToggleSidebar?: () => void
  /** Book format — drives which view modes are available and how the page
   *  indicator is labelled. EPUBs show only Text view and use "Ch." instead
   *  of "p." since they have no real pages. */
  format?: 'pdf' | 'epub'
}

export function ReaderToolbar({
  bookId, bookTitle, sectionTitle, isRead, sectionId,
  viewMode, onViewModeChange,
  readingMode, onReadingModeChange,
  onReadToggle,
  sectionProgress,
  showIndicators, onToggleIndicators,
  syncScroll, onSyncScrollChange,
  currentPage, totalSectionPages, startPage,
  onPrevPage, onNextPage, canGoPrev, canGoNext,
  showLineNumbers, onLineNumbersToggle,
  sidebarCollapsed, onToggleSidebar,
  format = 'pdf',
}: ReaderToolbarProps) {
  const isEpub = format === 'epub'
  const router = useRouter()
  const { getKeysDisplay } = useShortcuts()
  const [isTogglingRead, setIsTogglingRead] = useState(false)
  // Mirror of isTogglingRead. The state drives the disabled/aria-busy UI, but the
  // re-entrancy guard has to read a value that is already true by the time a second
  // trigger arrives — setState is async, so two rapid presses (badge click racing the
  // keyboard shortcut) would both see `false` and fire two writes.
  const togglingRef = useRef(false)

  /** Get the display string for a shortcut, falling back to the provided default */
  const sk = (id: string, fallback: string) => getKeysDisplay(id) ?? fallback

  // Memoized: useShortcut re-registers whenever the action identity changes, and
  // register() sets provider state, so an inline closure would loop.
  const handleToggleRead = useCallback(async () => {
    if (togglingRef.current) return
    togglingRef.current = true
    setIsTogglingRead(true)
    try {
      const { SectionRepository } = await import('@/lib/repositories')
      const sectionRepo = new SectionRepository()
      if (isRead) {
        await sectionRepo.markAsUnread(sectionId)
        onReadToggle()
      } else {
        const bookJustCompleted = await sectionRepo.markAsRead(sectionId)
        onReadToggle(bookJustCompleted)
      }
    } catch (err) {
      toast.error('Failed to update read state', { duration: 5000 })
      console.error('Failed to toggle read state:', err)
    } finally {
      togglingRef.current = false
      setIsTogglingRead(false)
    }
  }, [isRead, sectionId, onReadToggle])

  const handleBackToDashboard = useCallback(() => {
    router.push(`/book/${bookId}`)
  }, [router, bookId])

  // Guarded rather than conditionally registered: the reading-mode buttons only
  // render for paged formats, and a hook cannot be called conditionally.
  const handleScrollMode = useCallback(() => {
    if (isEpub) return
    onReadingModeChange('scroll')
  }, [isEpub, onReadingModeChange])

  const handleFlipMode = useCallback(() => {
    if (isEpub) return
    onReadingModeChange('flip')
  }, [isEpub, onReadingModeChange])

  // Every id the tooltips below advertise has to be a real registration — an
  // unregistered combo falls straight through to the browser, so the hint is a
  // promise the app never keeps (and Ctrl+R/Ctrl+S would have hit reload and the
  // save dialog). Defaults mirror GLOBAL_SHORTCUTS in settings/keymap-settings.tsx;
  // the provider layers any user override from bbb-settings.keymapOverrides on top
  // at register time, which is also what makes getKeysDisplay show the rebound combo.
  useShortcut('back-to-dashboard', 'Back to Dashboard', 'Ctrl+b', handleBackToDashboard)
  useShortcut('toggle-read', 'Toggle Read', 'Ctrl+Enter', handleToggleRead)
  useShortcut('reading-mode-scroll', 'Scroll Mode', 'Ctrl+Shift+s', handleScrollMode)
  useShortcut('reading-mode-flip', 'Flip Mode', 'Ctrl+Shift+f', handleFlipMode)

  return (
    <div className="border-b bg-background">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <BlockTooltip label={sidebarCollapsed ? 'Show Sections' : 'Hide Sections'} shortcut={sk('toggle-sidebar', '⌃ [')}>
            <button
              onClick={onToggleSidebar}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
              aria-label={sidebarCollapsed ? 'Show sections sidebar' : 'Hide sections sidebar'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="12" height="12" rx="1" />
                <line x1="6" y1="2" x2="6" y2="14" />
              </svg>
            </button>
          </BlockTooltip>
          <BlockTooltip label="Back to Dashboard" shortcut={sk('back-to-dashboard', '⌃ B')}>
            <Link href={`/book/${bookId}`}>
              <Button variant="ghost" size="sm">&larr; Dashboard</Button>
            </Link>
          </BlockTooltip>
          {bookTitle && (
            <>
              <span className="text-sm text-muted-foreground truncate max-w-[180px]">{bookTitle}</span>
              <span className="text-muted-foreground/50">/</span>
            </>
          )}
          <span className="text-sm font-medium truncate max-w-[200px]">{sectionTitle}</span>
          <BlockTooltip label={isRead ? 'Mark as Unread' : 'Mark as Read'} shortcut={sk('toggle-read', '⌃ ↵')}>
            <Badge
              asChild
              variant={isRead ? 'default' : 'outline'}
              className={`cursor-pointer ${isTogglingRead ? 'pointer-events-none opacity-60' : ''}`}
              aria-busy={isTogglingRead}
            >
              <button
                type="button"
                onClick={handleToggleRead}
                aria-pressed={isRead}
                disabled={isTogglingRead}
              >
                {isRead ? 'Read' : 'Mark as Read'}
              </button>
            </Badge>
          </BlockTooltip>
        </div>
        <div className="flex items-center gap-2">
          {/* .nib element indicator toggle */}
          <BlockTooltip label="Toggle Element Labels" shortcut={sk('toggle-indicators', '⌃ I')} hint="Show/hide paragraph, header, section indicators">
            <button
              onClick={onToggleIndicators}
              aria-pressed={!!showIndicators}
              className={`px-3 py-1 text-xs border rounded-md transition-colors ${
                showIndicators
                  ? 'bg-amber-500/20 text-amber-600 border-amber-500/30'
                  : 'hover:bg-muted'
              }`}
            >
              {showIndicators ? '⊟ Labels' : '⊞ Labels'}
            </button>
          </BlockTooltip>
          {/* Line numbers toggle — only in text/side-by-side modes */}
          {(viewMode === 'text' || viewMode === 'side-by-side') && (
            <BlockTooltip label={showLineNumbers ? 'Hide Line Numbers' : 'Show Line Numbers'} shortcut={sk('toggle-line-numbers', '⌃⇧ L')} hint="Relative line numbers gutter">
              <button
                onClick={onLineNumbersToggle}
                aria-pressed={!!showLineNumbers}
                className={`px-3 py-1 text-xs border rounded-md transition-colors font-mono ${
                  showLineNumbers
                    ? 'bg-violet-500/20 text-violet-500 border-violet-500/30'
                    : 'hover:bg-muted'
                }`}
              >
                {showLineNumbers ? '# Lines On' : '# Lines Off'}
              </button>
            </BlockTooltip>
          )}
          {/* View mode toggle — EPUBs only expose Text view */}
          {!isEpub && (
            <div className="flex border rounded-md">
              {(['pdf', 'text', 'side-by-side'] as ViewMode[]).map(mode => {
                const shortcutIdMap: Record<string, string> = { pdf: 'view-pdf', text: 'view-text', 'side-by-side': 'view-side-by-side' }
                const fallbackMap: Record<string, string> = { pdf: '⌃ 1', text: '⌃ 2', 'side-by-side': '⌃ 3' }
                return (
                  <BlockTooltip key={mode} label={mode} shortcut={sk(shortcutIdMap[mode], fallbackMap[mode])}>
                    <button
                      onClick={() => onViewModeChange(mode)}
                      aria-pressed={viewMode === mode}
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
          )}
          {/* Reading mode toggle (scroll vs flip) - only for PDF modes */}
          {!isEpub && viewMode !== 'text' && (
            <div className="flex border rounded-md">
              <BlockTooltip label="Scroll Mode" shortcut={sk('reading-mode-scroll', '⌃ ⇧ S')}>
                <button
                  onClick={() => onReadingModeChange('scroll')}
                  aria-pressed={readingMode === 'scroll'}
                  className={`px-3 py-1 text-xs ${
                    readingMode === 'scroll' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  Scroll
                </button>
              </BlockTooltip>
              <BlockTooltip label="Flip Mode" shortcut={sk('reading-mode-flip', '⌃ ⇧ F')}>
                <button
                  onClick={() => onReadingModeChange('flip')}
                  aria-pressed={readingMode === 'flip'}
                  className={`px-3 py-1 text-xs ${
                    readingMode === 'flip' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                >
                  Flip
                </button>
              </BlockTooltip>
            </div>
          )}
          {/* Sync scroll toggle — only in side-by-side scroll mode */}
          {viewMode === 'side-by-side' && readingMode === 'scroll' && (
            <BlockTooltip label={syncScroll ? 'Disable Sync Scroll' : 'Enable Sync Scroll'}>
              <button
                onClick={() => onSyncScrollChange?.(!syncScroll)}
                aria-pressed={!!syncScroll}
                className={`px-3 py-1 text-xs border rounded-md transition-colors ${
                  syncScroll
                    ? 'bg-blue-500/20 text-blue-600 border-blue-500/30'
                    : 'hover:bg-muted'
                }`}
              >
                {syncScroll ? '⇅ Sync On' : '⇅ Sync Off'}
              </button>
            </BlockTooltip>
          )}
          {/* Page/Section nav */}
          <div className="flex items-center gap-2">
            <BlockTooltip label={isEpub ? 'Previous Chapter' : viewMode === 'text' ? 'Previous Section' : 'Previous Page'} shortcut={sk('prev-page', '⌃ ←')}>
              <Button variant="outline" size="sm" onClick={onPrevPage} disabled={!canGoPrev}>
                &larr; Prev
              </Button>
            </BlockTooltip>
            {isEpub ? (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Ch.{startPage}
              </span>
            ) : viewMode === 'text' ? (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                p.{startPage}–{startPage + totalSectionPages - 1}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {currentPage - startPage + 1}/{totalSectionPages} (p.{currentPage})
              </span>
            )}
            <BlockTooltip label={isEpub ? 'Next Chapter' : viewMode === 'text' ? 'Next Section' : 'Next Page'} shortcut={sk('next-page', '⌃ →')}>
              <Button variant="outline" size="sm" onClick={onNextPage} disabled={!canGoNext}>
                Next &rarr;
              </Button>
            </BlockTooltip>
          </div>
        </div>
      </div>
      {/* Section progress bar */}
      <div className="relative h-1.5 w-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full bg-teal-500 transition-all duration-150"
          style={{ width: `${sectionProgress}%` }}
        />
        {/* Segment dividers every 10% */}
        {[10,20,30,40,50,60,70,80,90].map(p => (
          <div
            key={p}
            className="absolute top-0 bottom-0 w-px bg-zinc-950/50"
            style={{ left: `${p}%` }}
          />
        ))}
      </div>
    </div>
  )
}
