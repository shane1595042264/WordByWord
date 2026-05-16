import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

function makeJwt(expMsFromNow: number) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + expMsFromNow) / 1000) }))
  return `${header}.${payload}.sig`
}

type FetchCall = { url: string; signal: AbortSignal | null }

function setupFetch() {
  const calls: FetchCall[] = []
  const resolvers = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let id = 0
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const myId = id++
    const signal = init?.signal ?? null
    calls.push({ url, signal })
    return new Promise((resolve, reject) => {
      resolvers.set(myId, { resolve, reject })
      if (signal) {
        signal.addEventListener('abort', () => {
          resolvers.delete(myId)
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      }
    })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return {
    calls,
    resolveAt(index: number, body: unknown, status = 200) {
      const r = resolvers.get(index)
      if (!r) throw new Error(`no pending resolver ${index}`)
      resolvers.delete(index)
      r.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })
    },
  }
}

async function loadHook() {
  vi.resetModules()
  const mod = await import('../use-processing-status')
  return mod.useProcessingStatus
}

describe('useProcessingStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('aborts the in-flight /processing fetch on unmount and does not setState', async () => {
    const fx = setupFetch()
    const useProcessingStatus = await loadHook()
    const { result, unmount } = renderHook(() => useProcessingStatus('job-1'))

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(1))
    expect(fx.calls[0].url).toContain('/api/auth/token')
    fx.resolveAt(0, { token: makeJwt(60_000) })

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(2))
    const procCall = fx.calls[1]
    expect(procCall.url).toContain('/processing/job-1')
    expect(procCall.signal).not.toBeNull()
    expect(procCall.signal!.aborted).toBe(false)

    unmount()
    expect(procCall.signal!.aborted).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('reuses the cached JWT across consecutive polls (no /api/auth/token spam)', async () => {
    const fx = setupFetch()
    const useProcessingStatus = await loadHook()
    const { unmount } = renderHook(() => useProcessingStatus('job-x'))

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(1))
    expect(fx.calls[0].url).toContain('/api/auth/token')
    fx.resolveAt(0, { token: makeJwt(60_000) })

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(2))
    expect(fx.calls[1].url).toContain('/processing/job-x')
    fx.resolveAt(1, { status: 'processing', progress: 10, stage: 'ocr', error: null, bookId: null })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3001)
    })
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(3))

    expect(fx.calls[2].url).toContain('/processing/job-x')
    expect(fx.calls.filter((c) => c.url.includes('/api/auth/token')).length).toBe(1)

    unmount()
  })

  it('drops stale response when jobId becomes undefined mid-poll', async () => {
    const fx = setupFetch()
    const useProcessingStatus = await loadHook()
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useProcessingStatus(id),
      { initialProps: { id: 'job-A' as string | undefined } },
    )

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(1))
    expect(fx.calls[0].url).toContain('/api/auth/token')
    fx.resolveAt(0, { token: makeJwt(60_000) })
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(2))

    rerender({ id: undefined })
    expect(fx.calls[1].signal!.aborted).toBe(true)
    expect(result.current.data).toBeNull()
  })

  it('refetches the token and retries once on 401', async () => {
    const fx = setupFetch()
    const useProcessingStatus = await loadHook()
    const { unmount } = renderHook(() => useProcessingStatus('job-401'))

    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(1))
    fx.resolveAt(0, { token: makeJwt(60_000) })
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(2))
    // /processing returns 401
    fx.resolveAt(1, { error: 'unauthorized' }, 401)
    // Hook should refetch token, then retry /processing
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(3))
    expect(fx.calls[2].url).toContain('/api/auth/token')
    fx.resolveAt(2, { token: makeJwt(60_000) })
    await waitFor(() => expect(fx.calls.length).toBeGreaterThanOrEqual(4))
    expect(fx.calls[3].url).toContain('/processing/job-401')
    unmount()
  })
})
