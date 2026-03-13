'use client'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteConfirmDialogProps {
  open: boolean
  count: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmDialog({ open, count, onConfirm, onCancel }: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel() }}>
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
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>
            Delete {count} book{count !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
