'use client'

export const dynamic = 'force-dynamic'

import { useState, useCallback } from 'react'
import { useBooks } from '@/hooks/use-books'
import { LibraryGrid } from '@/components/library/library-grid'
import { UploadDialog } from '@/components/library/upload-dialog'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { DeleteConfirmDialog } from '@/components/library/delete-confirm-dialog'
import { BookCardSkeleton } from '@/components/library/book-card-skeleton'

export default function HomePage() {
  const { books, loading, refresh } = useBooks()
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

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
          <h1 className="text-3xl font-bold">Nibbler</h1>
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
              <UploadDialog onBookImported={refresh} />
              {books.length > 0 && (
                <Button variant="outline" onClick={() => setEditMode(true)}>
                  Edit
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
      ) : (
        <LibraryGrid
          books={books}
          editMode={editMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onProcessingComplete={async () => {
            // Force full sync from epoch to pull new chapters/sections from processing
            localStorage.removeItem('nibble_lastSyncedAt')
            const { syncService } = await import('@/lib/services/sync-service')
            // @ts-ignore — reset init flag to force full sync
            syncService['hasInitSynced'] = false
            await syncService.sync()
            refresh()
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
