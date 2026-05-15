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
const TOKEN_REFRESH_BUFFER_MS = 30_000

let tokenCache: { token: string; expMs: number } | null = null
let tokenPromise: Promise<string> | null = null

function decodeExpMs(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

async function getToken(forceRefresh = false): Promise<string> {
  if (forceRefresh) {
    tokenCache = null
  } else if (tokenCache && tokenCache.expMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
    return tokenCache.token
  }
  if (!tokenPromise) {
    const p = (async () => {
      const res = await fetch('/api/auth/token')
      if (!res.ok) throw new Error('Auth failed')
      const { token } = await res.json()
      tokenCache = { token, expMs: decodeExpMs(token) }
      return token as string
    })()
    tokenPromise = p
    p.finally(() => {
      if (tokenPromise === p) tokenPromise = null
    })
  }
  return tokenPromise
}

export function useProcessingStatus(jobId: string | undefined) {
  const [data, setData] = useState<ProcessingStatus | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const failureCountRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | undefined>(jobId)

  const poll = useCallback(async () => {
    if (!jobId) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal
    const startedJobId = jobId

    const aborted = () => signal.aborted || currentJobIdRef.current !== startedJobId

    try {
      let token = await getToken()
      if (aborted()) return

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
      let res = await fetch(`${apiUrl}/processing/${startedJobId}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      })
      if (aborted()) return

      if (res.status === 401) {
        token = await getToken(true)
        if (aborted()) return
        res = await fetch(`${apiUrl}/processing/${startedJobId}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal,
        })
        if (aborted()) return
      }

      if (!res.ok) throw new Error('Status check failed')
      const status = await res.json()
      if (aborted()) return

      setData(status)
      failureCountRef.current = 0
      setPollError(null)

      if (status.status === 'completed' || status.status === 'failed') {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }
    } catch (err) {
      if (signal.aborted) return
      if ((err as { name?: string })?.name === 'AbortError') return
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
    currentJobIdRef.current = jobId
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
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [jobId, poll])

  return { data, pollError }
}
