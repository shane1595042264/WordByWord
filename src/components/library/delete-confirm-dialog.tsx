'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { LoaderIcon } from 'lucide-react'

interface DeleteConfirmDialogProps {
  open: boolean
  count: number
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
  progress?: { current: number; total: number }
}

export function DeleteConfirmDialog({ open, count, onConfirm, onCancel, isDeleting = false, progress }: DeleteConfirmDialogProps) {
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) return
    if (isDeleting) return
    onCancel()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {count} book{count !== 1 ? 's' : ''}?</DialogTitle>
          <DialogDescription>
            This will permanently delete {count === 1 ? 'this book' : 'these books'} and
            all associated chapters, sections, and reading progress.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isDeleting}
            aria-busy={isDeleting}
            className="gap-1.5"
          >
            {isDeleting && <LoaderIcon className="h-4 w-4 animate-spin" />}
            {isDeleting
              ? progress && progress.total > 0
                ? `Deleting ${progress.current}/${progress.total}…`
                : 'Deleting…'
              : `Delete ${count} book${count !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
