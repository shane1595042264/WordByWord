import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { ProcessingLogDialog } from '../processing-log-dialog'

// The log pane polls /processing/:jobId/logs every 2s while a job is live. A 429
// there is self-inflicted (the app's own polling) and transient, so it must not
// tear the interval down for the rest of the job (KAN-293).
function mockFetch(sequence: Array<{ status: number; logs?: unknown[] }>) {
  let i = 0
  const logCalls: number[] = []
  const fetchMock = vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/auth/token')) {
      return { ok: true, status: 200, json: async () => ({ token: 'tok' }) }
    }
    const step = sequence[Math.min(i, sequence.length - 1)]
    i++
    logCalls.push(step.status)
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => ({ logs: step.logs ?? [] }),
    }
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { logCalls }
}

const entry = (message: string) => ({
  timestamp: new Date().toISOString(),
  level: 'info',
  stage: 'extract',
  message,
})

/** Advance the poll interval and drain the fetch promise chain deterministically. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

describe('ProcessingLogDialog transient 429 handling', () => {
  const realFetch = globalThis.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('keeps polling through a 429 and recovers on the next tick', async () => {
    const { logCalls } = mockFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, logs: [entry('extracted page 1')] },
    ])

    render(
      <ProcessingLogDialog jobId="job-1" bookTitle="Test Book" open onClose={() => {}} isLive />
    )

    // Initial fetch 429s — the pane must not show the terminal failure text.
    await advance(0)
    expect(logCalls).toEqual([429])
    expect(screen.queryByTestId('processing-log-error')).toBeNull()

    // The interval is still alive, so the next tick fires (the old code had
    // cleared it here and this would stay at one call).
    await advance(2000)
    expect(logCalls).toEqual([429, 429])
    expect(screen.queryByTestId('processing-log-error')).toBeNull()

    // Once the window drains, logs stream again.
    await advance(2000)
    expect(logCalls).toEqual([429, 429, 200])
    expect(screen.getByText(/extracted page 1/)).toBeTruthy()
    expect(screen.queryByTestId('processing-log-error')).toBeNull()
  })

  it('still stops polling permanently on a non-429 failure', async () => {
    const { logCalls } = mockFetch([{ status: 500 }])

    render(
      <ProcessingLogDialog jobId="job-2" bookTitle="Test Book" open onClose={() => {}} isLive />
    )

    await advance(0)
    expect(screen.getByTestId('processing-log-error').textContent).toMatch(/Failed to load logs/i)

    // Interval was torn down: no further requests.
    await advance(2000)
    await advance(2000)
    expect(logCalls).toEqual([500])
  })
})
