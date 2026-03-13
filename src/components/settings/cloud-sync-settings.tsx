'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { syncService, type CloudStatus } from '@/lib/services/sync-service'

export function CloudSyncSettings() {
  const [status, setStatus] = useState<CloudStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'download' | 'upload' | null>(null)
  const lastSynced = syncService.getLastSyncedAt()

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    const s = await syncService.getCloudStatus()
    setStatus(s)
    setLoading(false)
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const handleDownload = async () => {
    setConfirmAction(null)
    setSyncing(true)
    setMessage('Downloading from cloud...')
    try {
      const result = await syncService.downloadFromCloud()
      setMessage(`Downloaded ${result.booksDownloaded} book(s) from cloud. Refresh to see them.`)
      await refreshStatus()
    } catch (err) {
      setMessage(`Download failed: ${err}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleForceUpload = async () => {
    setConfirmAction(null)
    setSyncing(true)
    setMessage('Uploading all local data to cloud...')
    try {
      await syncService.forceUpload()
      setMessage('Upload complete. Cloud is now in sync with your local data.')
      await refreshStatus()
    } catch (err) {
      setMessage(`Upload failed: ${err}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleQuickSync = async () => {
    setSyncing(true)
    setMessage('Syncing...')
    try {
      await syncService.sync()
      setMessage('Sync complete.')
      await refreshStatus()
    } catch (err) {
      setMessage(`Sync failed: ${err}`)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Checking cloud status...</div>
  }

  return (
    <div className="space-y-6">
      {/* Cloud Status */}
      <div className="rounded-lg border p-4 space-y-2">
        <h3 className="font-semibold">Cloud Status</h3>
        {status ? (
          <div className="text-sm space-y-1">
            <p><span className="text-muted-foreground">Books:</span> {status.bookCount}</p>
            <p><span className="text-muted-foreground">Chapters:</span> {status.chapterCount}</p>
            <p><span className="text-muted-foreground">Sections:</span> {status.sectionCount}</p>
            <p><span className="text-muted-foreground">Vocabulary:</span> {status.vocabCount}</p>
            <p><span className="text-muted-foreground">Last cloud update:</span>{' '}
              {status.lastUpdated
                ? new Date(status.lastUpdated).toLocaleString()
                : 'Never'}
            </p>
            <p><span className="text-muted-foreground">Last synced from this device:</span>{' '}
              {lastSynced
                ? new Date(lastSynced).toLocaleString()
                : 'Never'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Could not connect to cloud. Are you logged in?</p>
        )}
      </div>

      {/* Sync Actions */}
      <div className="space-y-3">
        <Button onClick={handleQuickSync} disabled={syncing} className="w-full">
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>

        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            disabled={syncing}
            onClick={() => setConfirmAction('download')}
          >
            Download from Cloud
          </Button>
          <Button
            variant="outline"
            disabled={syncing}
            onClick={() => setConfirmAction('upload')}
          >
            Force Upload to Cloud
          </Button>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      {confirmAction === 'download' && (
        <div className="rounded-lg border border-blue-500/50 bg-blue-500/10 p-4 space-y-3">
          <p className="text-sm font-semibold">Download from Cloud</p>
          <p className="text-sm">
            This will <strong>replace</strong> your local library with the cloud version.
            All local books will be cleared and re-downloaded from the cloud.
          </p>
          {status && status.bookCount > 0 && (
            <p className="text-sm">
              Cloud has: {status.bookCount} book(s), {status.sectionCount} section(s), {status.vocabCount} vocab word(s)
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleDownload}>Yes, Download</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {confirmAction === 'upload' && (
        <div className="rounded-lg border border-orange-500/50 bg-orange-500/10 p-4 space-y-3">
          <p className="text-sm font-semibold">Force Upload to Cloud</p>
          <p className="text-sm">
            This will push ALL your local data to the cloud, overwriting any cloud data
            that conflicts. Use this if your local data is the &quot;correct&quot; version.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={handleForceUpload}>Yes, Override Cloud</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Status Message */}
      {message && (
        <div className="rounded-lg border p-3 text-sm">
          {message}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Sync runs automatically every 30 seconds when you make changes.
        Books are uploaded immediately after processing. Reading progress,
        vocabulary, and other changes are batched and synced periodically.
      </p>
    </div>
  )
}
