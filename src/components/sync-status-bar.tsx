'use client'

import { useState, useEffect, useRef } from 'react'

interface SyncProgress {
  current: number
  total: number
}

interface SyncStatus {
  status: 'syncing' | 'complete' | 'error'
  message: string
  progress: SyncProgress | null
}

export function SyncStatusBar() {
  const [visible, setVisible] = useState(false)
  const [displayText, setDisplayText] = useState('')
  const [status, setStatus] = useState<'syncing' | 'complete' | 'error' | 'idle'>('idle')
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetTextRef = useRef('')

  useEffect(() => {
    const onStatus = (e: Event) => {
      const { status: newStatus, message, progress: newProgress } = (e as CustomEvent<SyncStatus>).detail
      setProgress(newProgress)

      // Clear any pending hide timer
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }

      setStatus(newStatus)
      setVisible(true)

      // Typewriter effect
      targetTextRef.current = message
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current)
      setDisplayText('')

      let i = 0
      const type = () => {
        if (i < message.length) {
          setDisplayText(message.slice(0, i + 1))
          i++
          typeTimerRef.current = setTimeout(type, 20 + Math.random() * 30)
        }
      }
      type()

      // Auto-hide after completion. Errors stay visible until the user
      // dismisses them or the next syncing/complete event replaces them —
      // sync failures are actionable and must not vanish before being read.
      if (newStatus === 'complete') {
        setProgress(null)
        hideTimerRef.current = setTimeout(() => {
          setVisible(false)
          setStatus('idle')
        }, 3000)
      } else if (newStatus === 'error') {
        setProgress(null)
      }
    }

    window.addEventListener('nibble:sync-status', onStatus)
    return () => {
      window.removeEventListener('nibble:sync-status', onStatus)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current)
    }
  }, [])

  const dismiss = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
    if (typeTimerRef.current) {
      clearTimeout(typeTimerRef.current)
      typeTimerRef.current = null
    }
    setVisible(false)
    setStatus('idle')
  }

  if (!visible) return null

  const statusColor =
    status === 'syncing'
      ? 'bg-emerald-500'
      : status === 'complete'
        ? 'bg-sky-400'
        : 'bg-red-400'

  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-50
        flex flex-col gap-1.5
        rounded border border-zinc-700 bg-zinc-900/95 px-3 py-2
        font-mono text-xs text-zinc-300
        shadow-lg backdrop-blur-sm
        transition-all duration-300
        ${visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}
      `}
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor} ${status === 'syncing' ? 'animate-pulse' : ''}`} />
        <span className="select-none">
          {displayText}
          {status === 'syncing' && <span className="animate-blink ml-px">_</span>}
        </span>
        {status === 'error' && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss sync error"
            className="ml-1 shrink-0 rounded px-1 leading-none text-zinc-500 hover:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            ×
          </button>
        )}
      </div>
      {progress && progress.total > 0 && (
        <div className="w-48">
          <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-0.5 text-[10px] text-zinc-500">
            <span>{progress.current}/{progress.total} books</span>
            <span>{pct}%</span>
          </div>
        </div>
      )}
    </div>
  )
}
