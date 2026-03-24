'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface SyncStatusEvent {
  status: 'syncing' | 'complete' | 'error'
  message: string
}

/**
 * Hook to track sync status. Optionally shows toast notifications.
 * @param showToasts - If true, fires sonner toasts on complete/error. Default false.
 */
export function useSyncStatus({ showToasts = false } = {}) {
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    const onStatus = (e: Event) => {
      const { status, message } = (e as CustomEvent<SyncStatusEvent>).detail

      if (status === 'syncing') {
        setIsSyncing(true)
      } else if (status === 'complete') {
        setIsSyncing(false)
        if (showToasts) {
          toast.success('Library synced', {
            description: message,
            duration: 3000,
          })
        }
      } else if (status === 'error') {
        setIsSyncing(false)
        if (showToasts) {
          toast.error('Sync failed', {
            description: message,
            duration: 5000,
          })
        }
      }
    }

    window.addEventListener('nibble:sync-status', onStatus)
    return () => window.removeEventListener('nibble:sync-status', onStatus)
  }, [showToasts])

  return { isSyncing }
}
