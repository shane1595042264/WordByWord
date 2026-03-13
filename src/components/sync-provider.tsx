'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { syncService, type SyncConflict } from '@/lib/services/sync-service'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [conflict, setConflict] = useState<SyncConflict | null>(null)
  const [resolver, setResolver] = useState<((choice: 'cloud' | 'local' | 'auto') => void) | null>(null)

  const handleConflict = useCallback((c: SyncConflict): Promise<'cloud' | 'local' | 'auto'> => {
    return new Promise((resolve) => {
      setConflict(c)
      setResolver(() => (choice: 'cloud' | 'local' | 'auto') => {
        setConflict(null)
        setResolver(null)
        resolve(choice)
      })
    })
  }, [])

  useEffect(() => {
    if (status === 'authenticated') {
      syncService.onConflict(handleConflict)
      syncService.init()
      return () => syncService.destroy()
    }
  }, [status, handleConflict])

  return (
    <>
      {children}
      <Dialog open={conflict !== null} onOpenChange={(open) => {
        if (!open && resolver) resolver('auto')
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync Conflict Detected</DialogTitle>
            <DialogDescription>
              Your local library differs from the cloud. How would you like to resolve this?
            </DialogDescription>
          </DialogHeader>
          {conflict && (
            <div className="space-y-2 text-sm">
              {conflict.cloudDeletedBooks > 0 && (
                <p>{conflict.cloudDeletedBooks} book(s) were deleted on another device.</p>
              )}
              {conflict.cloudOnlyBooks > 0 && (
                <p>{conflict.cloudOnlyBooks} book(s) exist in cloud but not on this device.</p>
              )}
              {conflict.localOnlyBooks > 0 && (
                <p>{conflict.localOnlyBooks} book(s) exist locally but not in cloud.</p>
              )}
            </div>
          )}
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => resolver?.('local')}>
              Keep Local
            </Button>
            <Button onClick={() => resolver?.('cloud')}>
              Sync from Cloud
            </Button>
            <Button variant="secondary" onClick={() => resolver?.('auto')}>
              Auto (Recency Wins)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
