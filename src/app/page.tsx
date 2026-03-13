'use client'

export const dynamic = 'force-dynamic'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useBooks } from '@/hooks/use-books'
import { LibraryGrid } from '@/components/library/library-grid'
import { UploadDialog } from '@/components/library/upload-dialog'
import { Button } from '@/components/ui/button'
import { UserMenu } from '@/components/auth/user-menu'
import { DeleteConfirmDialog } from '@/components/library/delete-confirm-dialog'

export default function HomePage() {
  const { data: session } = useSession()
  const isAdmin = (session?.user as any)?.role === 'admin'
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
          <h1 className="text-3xl font-bold">Bit by Bit</h1>
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
              <Link href="/vocabulary">
                <Button variant="outline">Vocabulary</Button>
              </Link>
              <Link href="/settings">
                <Button variant="outline">Settings</Button>
              </Link>
              {isAdmin && (
                <Link href="/marketplace">
                  <Button variant="outline">Marketplace</Button>
                </Link>
              )}
              <UserMenu />
            </>
          )}
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
      ) : (
        <LibraryGrid
          books={books}
          editMode={editMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
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
