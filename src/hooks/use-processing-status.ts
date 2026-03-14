'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface ProcessingStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  stage: string | null
  error: string | null
  bookId: string | null
}

export function useProcessingStatus(jobId: string | undefined) {
  const [data, setData] = useState<ProcessingStatus | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!jobId) return
    try {
      const tokenRes = await fetch('/api/auth/token')
      if (!tokenRes.ok) return
      const { token } = await tokenRes.json()
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      const res = await fetch(`${apiUrl}/processing/${jobId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return
      const status = await res.json()
      setData(status)

      if (status.status === 'completed' || status.status === 'failed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch {
      // ignore poll errors
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

  return data
}
