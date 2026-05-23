'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useBooks } from '@/hooks/use-books'
import { LibraryGrid } from '@/components/library/library-grid'
import { UploadDialog } from '@/components/library/upload-dialog'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { DeleteConfirmDialog } from '@/components/library/delete-confirm-dialog'
import { BookCardSkeleton } from '@/components/library/book-card-skeleton'
import { RefreshCwIcon, LoaderIcon, BookOpenIcon } from 'lucide-react'
import Link from 'next/link'
import { useSyncStatus } from '@/hooks/use-sync-status'
import { toast } from 'sonner'

export default function HomePage() {
  const { books, loading, error, refresh } = useBooks()
  const { status } = useSession()
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const { isSyncing: backgroundSyncing, progress: syncProgress } = useSyncStatus({ showToasts: true })

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
      await syncService.sync()
      setLastSynced(syncService.getLastSyncedAt())
      refresh()
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

  const toggleSelect = useCallback((id: string, event?: React.MouseEvent) => {
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
    const { BookRepository } = await import('@/lib/repositories/book-repository')
    const repo = new BookRepository()
    for (const id of selectedIds) {
      await repo.delete(id)
    }
    setShowDeleteDialog(false)
    setSelectedIds(new Set())
    setEditMode(false)
    refresh()
  }, [selectedIds, refresh])

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold">Nibbler</h1>
            {status === 'authenticated' && backgroundSyncing && (
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-muted-foreground">Your reading progress, section by section</p>
        </div>
        <div className="flex gap-2 items-center">
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
                <div className="flex flex-col items-center min-w-[120px]">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={syncing}
                    onClick={handleSyncNow}
                    className="gap-1.5 w-full"
                  >
                    <RefreshCwIcon className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                    {syncing
                      ? syncProgress
                        ? `${syncProgress.current}/${syncProgress.total} books`
                        : 'Syncing...'
                      : 'Sync Now'}
                  </Button>
                  {syncing && syncProgress && syncProgress.total > 0 ? (
                    <div className="w-full mt-1.5">
                      <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                          style={{ width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground mt-1">
                      {lastSynced
                        ? `Last sync: ${new Date(lastSynced).toLocaleString()}`
                        : 'Not synced yet'}
                    </span>
                  )}
                </div>
              )}
              <a
                href="https://shanejli.com/knowledge"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm" className="gap-1.5">
                  <BookOpenIcon className="h-4 w-4" />
                  Vocabulary
                  <span aria-hidden="true" className="text-xs opacity-60">↗</span>
                </Button>
              </a>
              <UploadDialog onBookImported={refresh} />
              {books.length > 0 && (
                <Button variant="outline" onClick={() => setEditMode(true)}>
                  Manage
                </Button>
              )}
              <UserMenu />
            </>
          )}
        </div>
      </div>
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <BookCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-destructive text-lg font-medium mb-2">Something went wrong</p>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={refresh}>Try Again</Button>
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
              await syncService.sync()
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
      />
    </div>
  )
}
