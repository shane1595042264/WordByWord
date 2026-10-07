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

const SYNC_TOAST_ID = 'sync-status'

/**
 * A committed sync fires every 30-120s for an actively scrolling reader, so the
 * success notification has to stay out of the way (KAN-336). A `toast.custom`
 * carries `data-styled="false"`, which drops sonner's 356px width, 16px padding,
 * rich background and close button — leaving just this pill. The
 * `justify-end` wrapper is load-bearing: the sonner <li> is absolutely
 * positioned inside a 356px-wide fixed <ol>, so a shrink-to-fit child would
 * otherwise sit a full toast-width away from the corner.
 */
function SyncedPill({ message }: { message: string }) {
  return (
    <div className="flex w-full justify-end">
      <div
        title={message}
        className="flex items-center gap-1.5 rounded-full border border-border bg-background/95 px-2 py-1 font-mono text-[11px] leading-none text-foreground shadow-sm backdrop-blur-sm"
      >
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
        <span>Synced</span>
      </div>
    </div>
  )
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
          // Routine success — a pill, not a card. The only `complete` message the
          // sync service emits is ':sync complete', which the pill already says,
          // so it moves to the title attribute rather than a second line of text.
          toast.custom(() => <SyncedPill message={message} />, {
            // Fixed id so back-to-back syncs reuse the one slot instead of
            // stacking pills up to sonner's visibleToasts limit.
            id: SYNC_TOAST_ID,
            className: 'w-full',
            duration: 1500,
          })
        }
      } else if (status === 'error') {
        setIsSyncing(false)
        setProgress(null)
        if (showToasts) {
          // Sync failures are actionable ("will retry" / "try Download again")
          // and must not auto-dismiss before the user reads them.
          toast.error('Sync failed', {
            description: message,
            duration: Infinity,
            closeButton: true,
          })
        }
      }
    }

    window.addEventListener('nibble:sync-status', onStatus)
    return () => window.removeEventListener('nibble:sync-status', onStatus)
  }, [showToasts])

  return { isSyncing, progress }
}
