'use client'

import { useState, useEffect, useRef } from 'react'

interface SyncStatus {
  status: 'syncing' | 'complete' | 'error'
  message: string
}

export function SyncStatusBar() {
  const [visible, setVisible] = useState(false)
  const [displayText, setDisplayText] = useState('')
  const [status, setStatus] = useState<'syncing' | 'complete' | 'error' | 'idle'>('idle')
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const targetTextRef = useRef('')

  useEffect(() => {
    const onStatus = (e: Event) => {
      const { status: newStatus, message } = (e as CustomEvent<SyncStatus>).detail

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

      // Auto-hide after completion/error
      if (newStatus === 'complete' || newStatus === 'error') {
        hideTimerRef.current = setTimeout(() => {
          setVisible(false)
          setStatus('idle')
        }, 3000)
      }
    }

    window.addEventListener('nibble:sync-status', onStatus)
    return () => {
      window.removeEventListener('nibble:sync-status', onStatus)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current)
    }
  }, [])

  if (!visible) return null

  const statusColor =
    status === 'syncing'
      ? 'bg-emerald-500'
      : status === 'complete'
        ? 'bg-sky-400'
        : 'bg-red-400'

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-50
        flex items-center gap-2
        rounded border border-zinc-700 bg-zinc-900/95 px-3 py-1.5
        font-mono text-xs text-zinc-300
        shadow-lg backdrop-blur-sm
        transition-all duration-300
        ${visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}
      `}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusColor} ${status === 'syncing' ? 'animate-pulse' : ''}`} />
      <span className="select-none">
        {displayText}
        {status === 'syncing' && <span className="animate-blink ml-px">_</span>}
      </span>
    </div>
  )
}
