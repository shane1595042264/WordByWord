'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface LogEntry {
  timestamp: string
  level: string
  stage: string
  message: string
}

type FetchError = 'session_expired' | 'fetch_failed'

interface ProcessingLogDialogProps {
  jobId: string
  bookTitle: string
  open: boolean
  onClose: () => void
  /** When true, polls for new logs every 2s. When false, fetches once. Default: true */
  isLive?: boolean
}

export function ProcessingLogDialog({ jobId, bookTitle, open, onClose, isLive = true }: ProcessingLogDialogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [fetchError, setFetchError] = useState<FetchError | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastTimestampRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFetchError(null)
    setLogs([])
    lastTimestampRef.current = null
    let interval: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval)
        interval = undefined
      }
    }

    const fetchLogs = async () => {
      try {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) {
          if (cancelled) return
          setFetchError('session_expired')
          stopPolling()
          return
        }
        const { token } = await tokenRes.json()
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
        // Server filter is gte; bump by 1ms to avoid re-shipping the boundary row.
        let url = `${apiUrl}/processing/${jobId}/logs`
        if (lastTimestampRef.current) {
          const boundary = new Date(new Date(lastTimestampRef.current).getTime() + 1).toISOString()
          url += `?since=${encodeURIComponent(boundary)}`
        }
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          if (cancelled) return
          setFetchError(res.status === 401 ? 'session_expired' : 'fetch_failed')
          stopPolling()
          return
        }
        const data = await res.json()
        if (cancelled) return
        const newLogs: LogEntry[] = data.logs || []
        if (newLogs.length === 0) return
        lastTimestampRef.current = newLogs[newLogs.length - 1].timestamp
        setLogs(prev => prev.concat(newLogs))
      } catch (err) {
        console.error('Failed to fetch processing logs:', err)
        if (cancelled) return
        setFetchError('fetch_failed')
        stopPolling()
      }
    }

    fetchLogs()
    if (isLive) {
      interval = setInterval(fetchLogs, 2000)
    }
    return () => {
      cancelled = true
      stopPolling()
    }
  }, [open, jobId, isLive])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const downloadLog = async () => {
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) {
        toast.error('Session expired - please reload', { duration: 5000 })
        return
      }
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiUrl}/processing/${jobId}/logs/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        toast.error(res.status === 401 ? 'Session expired - please reload' : 'Failed to download log', { duration: 5000 })
        return
      }
      const text = await res.text()
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `processing-${bookTitle.replace(/\s+/g, '-')}.log`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to download processing log:', err)
      toast.error('Failed to download log', { duration: 5000 })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Processing Log — {bookTitle}</DialogTitle>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto bg-black rounded-md p-3 font-mono text-xs text-green-400 min-h-[300px]"
        >
          {fetchError ? (
            <div data-testid="processing-log-error" className="text-red-400">
              {fetchError === 'session_expired'
                ? 'Session expired — please reload the page to continue viewing logs.'
                : 'Failed to load logs — please try again.'}
            </div>
          ) : logs.length === 0 ? (
            <span className="text-gray-500">Waiting for logs...</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`${
                log.level === 'error' ? 'text-red-400' :
                log.level === 'warn' ? 'text-yellow-400' :
                'text-green-400'
              }`}>
                <span className="text-gray-500">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>{' '}
                <span className="text-blue-400">[{log.stage}]</span>{' '}
                {log.message}
              </div>
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={downloadLog}>
            Download Log
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
