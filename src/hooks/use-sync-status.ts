'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'

interface SyncProgress {
  current: number
  total: number
}

interface SyncStatusEvent {
  status: 'syncing' | 'complete' | 'error'
  message: string
  progress: SyncProgress | null
}

/**
 * Hook to track sync status. Optionally shows toast notifications.
 * @param showToasts - If true, fires sonner toasts on complete/error. Default false.
 */
export function useSyncStatus({ showToasts = false } = {}) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)

  useEffect(() => {
    const onStatus = (e: Event) => {
      const { status, message: rawMessage, progress: newProgress } = (e as CustomEvent<SyncStatusEvent>).detail
      const message = rawMessage.replace(/^:/, '').trim()

      if (status === 'syncing') {
        setIsSyncing(true)
        setProgress(newProgress)
      } else if (status === 'complete') {
        setIsSyncing(false)
        setProgress(null)
        if (showToasts) {
          toast.success('Library synced', {
            description: message,
            duration: 3000,
          })
        }
      } else if (status === 'error') {
        setIsSyncing(false)
        setProgress(null)
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

  return { isSyncing, progress }
}
