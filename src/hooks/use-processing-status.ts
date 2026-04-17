'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ProcessingStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  stage: string | null
  error: string | null
  bookId: string | null
}

const MAX_CONSECUTIVE_FAILURES = 3

export function useProcessingStatus(jobId: string | undefined) {
  const [data, setData] = useState<ProcessingStatus | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failureCountRef = useRef(0)

  const poll = useCallback(async () => {
    if (!jobId) return
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) throw new Error('Auth failed')
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiUrl}/processing/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Status check failed')
      const status = await res.json()
      setData(status)
      failureCountRef.current = 0
      setPollError(null)

      if (status.status === 'completed' || status.status === 'failed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch {
      failureCountRef.current++
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setPollError('Lost connection to server. Processing may still be running — refresh to check.')
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    }
  }, [jobId])

  useEffect(() => {
    if (!jobId) {
      setData(null)
      return
    }
    poll()
    intervalRef.current = setInterval(poll, 3000)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && jobId) poll()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [jobId, poll])

  return { data, pollError }
}
