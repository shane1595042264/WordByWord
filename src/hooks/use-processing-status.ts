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
const NORMAL_POLL_INTERVAL_MS = 3000
const BACKOFF_DELAYS_MS = [15_000, 30_000, 60_000]

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
  const backoffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffStepRef = useRef(0)
  const failureCountRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const currentJobIdRef = useRef<string | undefined>(jobId)
  const pollRef = useRef<() => void>(() => {})

  const clearBackoff = useCallback(() => {
    if (backoffTimeoutRef.current) {
      clearTimeout(backoffTimeoutRef.current)
      backoffTimeoutRef.current = null
    }
  }, [])

  const startNormalInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => pollRef.current(), NORMAL_POLL_INTERVAL_MS)
  }, [])

  const scheduleBackoff = useCallback(() => {
    clearBackoff()
    const step = Math.min(backoffStepRef.current, BACKOFF_DELAYS_MS.length - 1)
    const delay = BACKOFF_DELAYS_MS[step]
    backoffStepRef.current = Math.min(backoffStepRef.current + 1, BACKOFF_DELAYS_MS.length - 1)
    backoffTimeoutRef.current = setTimeout(() => {
      backoffTimeoutRef.current = null
      pollRef.current()
    }, delay)
  }, [clearBackoff])

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

      const terminal = status.status === 'completed' || status.status === 'failed'
      if (terminal) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        clearBackoff()
      } else if (!intervalRef.current) {
        backoffStepRef.current = 0
        clearBackoff()
        startNormalInterval()
      }
    } catch (err) {
      if (signal.aborted) return
      if ((err as { name?: string })?.name === 'AbortError') return
      failureCountRef.current++
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        setPollError('Lost connection to server. Retrying in the background...')
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
          intervalRef.current = null
        }
        scheduleBackoff()
      }
    }
  }, [jobId, clearBackoff, scheduleBackoff, startNormalInterval])

  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  const retry = useCallback(() => {
    if (!jobId) return
    failureCountRef.current = 0
    backoffStepRef.current = 0
    clearBackoff()
    setPollError(null)
    if (!intervalRef.current) startNormalInterval()
    pollRef.current()
  }, [jobId, clearBackoff, startNormalInterval])

  useEffect(() => {
    currentJobIdRef.current = jobId
    if (!jobId) {
      setData(null)
      return
    }
    intervalRef.current = setInterval(() => pollRef.current(), NORMAL_POLL_INTERVAL_MS)
    poll()

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && jobId) {
        if (!intervalRef.current) {
          backoffStepRef.current = 0
          clearBackoff()
          startNormalInterval()
        }
        pollRef.current()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      clearBackoff()
      document.removeEventListener('visibilitychange', onVisibility)
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [jobId, poll, clearBackoff, startNormalInterval])

  return { data, pollError, retry }
}
