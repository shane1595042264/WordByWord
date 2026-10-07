import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'

const custom = vi.fn()
const success = vi.fn()
const error = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    custom: (...args: unknown[]) => custom(...args),
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}))

import { useSyncStatus } from '../use-sync-status'

function emit(status: 'syncing' | 'complete' | 'error', message: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent('nibble:sync-status', { detail: { status, message, progress: null } }),
    )
  })
}

describe('useSyncStatus toasts (KAN-336)', () => {
  beforeEach(() => {
    custom.mockClear()
    success.mockClear()
    error.mockClear()
  })

  it('renders a committed sync as a compact custom pill, not a full success card', () => {
    renderHook(() => useSyncStatus({ showToasts: true }))
    emit('complete', ':sync complete')

    expect(success).not.toHaveBeenCalled()
    expect(custom).toHaveBeenCalledTimes(1)

    const [, opts] = custom.mock.calls[0] as [unknown, Record<string, unknown>]
    // Short-lived and slot-reusing, so back-to-back syncs cannot stack up.
    expect(opts.duration).toBe(1500)
    expect(opts.id).toBe('sync-status')
    // No `description` — the second line of text is what made the old card tall.
    expect(opts).not.toHaveProperty('description')
  })

  it('pills the status word and keeps the raw message only as a hover title', () => {
    renderHook(() => useSyncStatus({ showToasts: true }))
    emit('complete', ':sync complete')

    const [renderPill] = custom.mock.calls[0] as [(id: string) => ReactElement]
    const { container } = render(renderPill('sync-status'))

    expect(container.textContent).toBe('Synced')
    expect(container.querySelector('[title="sync complete"]')).not.toBeNull()
    // Right-anchored: the sonner <li> is absolutely positioned inside a 356px
    // <ol>, so without justify-end the pill sits a toast-width off the corner.
    expect(container.firstElementChild?.className).toContain('justify-end')
  })

  it('leaves sync failures as the full, non-expiring, dismissible card', () => {
    renderHook(() => useSyncStatus({ showToasts: true }))
    emit('error', ':sync failed')

    expect(custom).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)

    const [title, opts] = error.mock.calls[0] as [string, Record<string, unknown>]
    expect(title).toBe('Sync failed')
    expect(opts.description).toBe('sync failed')
    expect(opts.duration).toBe(Infinity)
    expect(opts.closeButton).toBe(true)
  })

  it('stays silent entirely when showToasts is off', () => {
    renderHook(() => useSyncStatus())
    emit('complete', ':sync complete')
    emit('error', ':sync failed')

    expect(custom).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('still tracks syncing state and progress independently of the toasts', () => {
    const { result } = renderHook(() => useSyncStatus({ showToasts: true }))
    act(() => {
      window.dispatchEvent(
        new CustomEvent('nibble:sync-status', {
          detail: { status: 'syncing', message: ':pull 1/4 books', progress: { current: 1, total: 4 } },
        }),
      )
    })
    expect(result.current.isSyncing).toBe(true)
    expect(result.current.progress).toEqual({ current: 1, total: 4 })

    emit('complete', ':sync complete')
    expect(result.current.isSyncing).toBe(false)
    expect(result.current.progress).toBeNull()
  })
})
