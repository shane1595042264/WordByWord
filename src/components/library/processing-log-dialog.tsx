'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface LogEntry {
  timestamp: string
  level: string
  stage: string
  message: string
}

interface ProcessingLogDialogProps {
  jobId: string
  bookTitle: string
  open: boolean
  onClose: () => void
}

export function ProcessingLogDialog({ jobId, bookTitle, open, onClose }: ProcessingLogDialogProps) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    let interval: ReturnType<typeof setInterval>

    const fetchLogs = async () => {
      try {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) return
        const { token } = await tokenRes.json()
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
        const res = await fetch(`${apiUrl}/processing/${jobId}/logs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return
        const data = await res.json()
        setLogs(data.logs || [])
      } catch { /* ignore */ }
    }

    fetchLogs()
    interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [open, jobId])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  const downloadLog = async () => {
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiUrl}/processing/${jobId}/logs/download`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const text = await res.text()
      const blob = new Blob([text], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `processing-${bookTitle.replace(/\s+/g, '-')}.log`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
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
          {logs.length === 0 ? (
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
