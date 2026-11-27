'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useBooks, type BookWithProgress } from '@/hooks/use-books'
import { LibraryGrid } from '@/components/library/library-grid'
import { UploadDialog } from '@/components/library/upload-dialog'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/app-header'
import { DeleteConfirmDialog } from '@/components/library/delete-confirm-dialog'
import { BookCardSkeleton } from '@/components/library/book-card-skeleton'
import { TypographicCover } from '@/components/library/typographic-cover'
import { RefreshCwIcon, LoaderIcon, ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useSyncStatus } from '@/hooks/use-sync-status'
import { toast } from 'sonner'

export default function HomePage() {
  const { books, loading, error, refresh } = useBooks()
  const { status } = useSession()
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteProgress, setDeleteProgress] = useState<{ current: number; total: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  // SyncProvider owns the sync toasts (it mounts useSyncStatus({ showToasts: true })
  // once, app-wide). This page only needs the syncing/progress state for its own UI —
  // enabling toasts here too fired every sync notification twice (duplicate stacked toasts).
  const { isSyncing: backgroundSyncing, progress: syncProgress } = useSyncStatus()

  // Load last synced timestamp and listen for sync completions
  useEffect(() => {
    if (status !== 'authenticated') return

    const loadLastSynced = async () => {
      const { syncService } = await import('@/lib/services/sync-service')
      setLastSynced(syncService.getLastSyncedAt())
    }
    loadLastSynced()

    const onSyncComplete = async () => {
      const { syncService } = await import('@/lib/services/sync-service')
      setLastSynced(syncService.getLastSyncedAt())
    }
    window.addEventListener('nibble:sync-complete', onSyncComplete)
    return () => window.removeEventListener('nibble:sync-complete', onSyncComplete)
  }, [status])

  const handleSyncNow = useCallback(async () => {
    setSyncing(true)
    try {
      const { syncService } = await import('@/lib/services/sync-service')
      // sync() resolves 'skipped' while another sync is in flight — wait it out
      // so the click always runs a real sync (KAN-401).
      const result = await syncService.syncAfterInFlight()
      setLastSynced(syncService.getLastSyncedAt())
      // complete/partial already fired nibble:sync-complete, which refreshes the
      // grid in place; only a skipped/failed sync still needs a (silent) re-read.
      if (result.status !== 'complete' && result.status !== 'partial') refresh({ silent: true })
    } catch (err) {
      console.error('Sync failed:', err)
      toast.error('Sync failed', {
        description: err instanceof Error ? err.message : 'An unexpected error occurred',
        duration: 5000,
      })
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const toggleSelect = useCallback((id: string, event?: React.MouseEvent | React.KeyboardEvent) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (event?.ctrlKey || event?.metaKey) {
        // Ctrl/Cmd click: toggle individual
        if (next.has(id)) next.delete(id)
        else next.add(id)
      } else if (event?.shiftKey && prev.size > 0) {
        // Shift click: range select
        const bookIds = books.map(b => b.id)
        const lastSelected = [...prev].pop()!
        const lastIdx = bookIds.indexOf(lastSelected)
        const currentIdx = bookIds.indexOf(id)
        const [start, end] = lastIdx < currentIdx ? [lastIdx, currentIdx] : [currentIdx, lastIdx]
        for (let i = start; i <= end; i++) next.add(bookIds[i])
      } else {
        // Regular click: toggle individual
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }, [books])

  const exitEditMode = useCallback(() => {
    setEditMode(false)
    setSelectedIds(new Set())
  }, [])

  const handleDeleteConfirmed = useCallback(async () => {
    if (isDeleting) return
    const ids = Array.from(selectedIds)
    const total = ids.length
    setIsDeleting(true)
    setDeleteProgress({ current: 0, total })
    let succeeded = 0
    let anyBackendSyncFailed = false
    let didThrow = false
    try {
      const { BookRepository } = await import('@/lib/repositories/book-repository')
      const repo = new BookRepository()
      for (const id of ids) {
        const result = await repo.delete(id)
        if (result.backendSyncFailed) anyBackendSyncFailed = true
        succeeded += 1
        setDeleteProgress({ current: succeeded, total })
      }
    } catch (err) {
      didThrow = true
      console.error('Delete failed mid-loop:', err)
    } finally {
      if (didThrow) {
        const failed = total - succeeded
        toast.error('Failed to delete some books', {
          description: `${succeeded} deleted, ${failed} not deleted. Refresh and try again.`,
          duration: 6000,
        })
      } else if (anyBackendSyncFailed) {
        toast.warning('Deleted locally — cloud sync failed, will retry')
      }
      setShowDeleteDialog(false)
      setSelectedIds(new Set())
      setEditMode(false)
      setIsDeleting(false)
      setDeleteProgress(null)
      refresh()
    }
  }, [selectedIds, isDeleting, refresh])

  // Real totals for the page subtitle. Books still processing have no
  // sections yet, so they add nothing to either count.
  const sectionsRead = books.reduce((sum, b) => sum + b.progress.read, 0)
  const sectionsTotal = books.reduce((sum, b) => sum + b.progress.total, 0)

  // The book you were last reading, unfinished: offered as a way straight back in.
  const resumeBook = editMode
    ? undefined
    : books
        .filter(b => b.lastReadAt && !b.completedAt && b.processingStatus === 'complete')
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))[0]

  return (
    <div className="min-h-[100dvh] bg-background">
      <AppHeader current="library" />

      <main className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
        <div className="flex flex-col gap-6 pt-10 pb-8 md:flex-row md:items-end md:justify-between md:pt-14">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">Library</h1>
              {status === 'authenticated' && backgroundSyncing && (
                <LoaderIcon aria-label="Syncing" className="h-5 w-5 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="mt-2 text-muted-foreground">
              {books.length > 0 && sectionsTotal > 0
                ? `${books.length} ${books.length === 1 ? 'book' : 'books'}, ${sectionsRead.toLocaleString()} of ${sectionsTotal.toLocaleString()} sections read`
                : 'Your reading progress, section by section'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {editMode ? (
              <>
                <Button
                  variant="destructive"
                  disabled={selectedIds.size === 0}
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete ({selectedIds.size})
                </Button>
                <Button variant="outline" onClick={() => {
                  // Select all
                  setSelectedIds(new Set(books.map(b => b.id)))
                }}>
                  Select All
                </Button>
                <Button variant="outline" onClick={exitEditMode}>
                  Done
                </Button>
              </>
            ) : (
              <>
                {status === 'authenticated' && (
                  <div className="flex items-center gap-3 rounded-md">
                    <div className="hidden text-right text-xs leading-tight text-muted-foreground lg:block">
                      {syncing && syncProgress && syncProgress.total > 0 ? (
                        <div className="w-28">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                              style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                            />
                          </div>
                        </div>
                      ) : lastSynced ? (
                        <>
                          <span className="block">Last sync</span>
                          <span className="block tabular-nums">{new Date(lastSynced).toLocaleString()}</span>
                        </>
                      ) : (
                        <span>Not synced yet</span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      disabled={syncing}
                      onClick={handleSyncNow}
                      className="gap-1.5"
                    >
                      <RefreshCwIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                      {syncing
                        ? syncProgress
                          ? `${syncProgress.current}/${syncProgress.total} books`
                          : 'Syncing...'
                        : 'Sync Now'}
                    </Button>
                  </div>
                )}
                {books.length > 0 && (
                  <Button variant="outline" onClick={() => setEditMode(true)}>
                    Manage
                  </Button>
                )}
                <UploadDialog onBookImported={refresh} />
              </>
            )}
          </div>
        </div>

        {!loading && !error && resumeBook && <ResumeStrip book={resumeBook} />}

      {loading ? (
        <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <BookCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <p className="mb-2 text-lg font-medium text-destructive">Something went wrong</p>
          <p className="mb-4 max-w-md text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => refresh()}>Try Again</Button>
        </div>
      ) : (
        <LibraryGrid
          books={books}
          editMode={editMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onProcessingComplete={async () => {
            try {
              const { syncService } = await import('@/lib/services/sync-service')
              syncService.forceFullSyncNext()
              // An in-flight sync took its snapshot before the job finished and
              // won't flip the card; a skipped sync() would strand it on
              // 'Complete!' until reload (KAN-401). The force-full flag survives
              // the in-flight run, so the follow-up is still a full pull.
              await syncService.syncAfterInFlight()
              refresh()
            } catch (err) {
              console.error('Post-processing sync failed:', err)
              toast.error('Sync failed after processing', {
                description: err instanceof Error ? err.message : 'An unexpected error occurred',
                duration: 5000,
              })
            }
          }}
        />
      )}

      <DeleteConfirmDialog
        open={showDeleteDialog}
        count={selectedIds.size}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setShowDeleteDialog(false)}
        isDeleting={isDeleting}
        progress={deleteProgress ?? undefined}
      />
      </main>
    </div>
  )
}

/** "Pick up where you left off": the most recently read unfinished book. */
function ResumeStrip({ book }: { book: BookWithProgress }) {
  // Remember which URL failed, so a new cover after a sync (or a different book) is retried
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const cover = book.coverImage !== failedCover ? book.coverImage : null

  return (
    <Link
      href={`/book/${book.id}`}
      className="group mb-10 flex items-center gap-5 rounded-xl border bg-card p-4 pr-5 transition-colors hover:border-primary/40 hover:bg-accent/40 sm:p-5"
    >
      <div className="relative aspect-[3/4] w-14 shrink-0 overflow-hidden rounded-sm bg-muted shadow-[0_6px_16px_-6px_oklch(0.22_0.04_170/0.45)] sm:w-16">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URLs and remote covers
          <img
            src={cover}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setFailedCover(cover)}
          />
        ) : (
          <TypographicCover title={book.title} size="sm" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">Pick up where you left off</p>
        <p className="truncate font-display text-lg font-semibold tracking-tight sm:text-xl">{book.title}</p>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${book.progress.percentage}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{book.progress.percentage}%</span>
        </div>
      </div>
      <span className="hidden items-center gap-1.5 text-sm font-medium text-primary sm:flex">
        Continue
        <ArrowRightIcon aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
      </span>
    </Link>
  )
}
