import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoTrack } from '../use-auto-track'

const markAsRead = vi.fn(async () => false)

vi.mock('@/lib/repositories', () => ({
  SectionRepository: class {
    markAsRead = markAsRead
  },
}))

vi.mock('@/lib/services/settings-service', () => ({
  SettingsService: class {
    getSettings() {
      return { trackingMode: 'endofpage', autoReadThresholdSeconds: 5 }
    }
  },
}))

/**
 * A stand-in for the text/PDF scroll container. jsdom doesn't lay anything
 * out, so scrollHeight/clientHeight are defined explicitly.
 */
function makeContainer({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true })
  document.body.appendChild(el)
  return el
}

/**
 * Flush the hook's dynamic imports and run the fake clock forward. `waitFor`
 * is unusable here — it polls on real timers, which never advance.
 */
async function settle(ms: number) {
  await act(async () => {
    // Two passes: the hook awaits dynamic imports before scheduling its
    // timers, so a timer registered part-way through the first advance would
    // otherwise be left pending.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < 10; i++) await Promise.resolve()
      await vi.advanceTimersByTimeAsync(ms)
    }
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** Run past the 1500ms initial check plus a few readiness retries. */
async function advancePastInitialCheck(extraMs = 2000) {
  await settle(1500 + extraMs)
}

describe('useAutoTrack', () => {
  beforeEach(async () => {
    // Warm the module cache before the clock is faked: the hook resolves these
    // via dynamic import(), which doesn't settle under fake timers.
    await import('@/lib/repositories')
    await import('@/lib/services/settings-service')
    vi.useFakeTimers()
    markAsRead.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('text mode', () => {
    it('does NOT mark read when the pane fits but no content has rendered (KAN-300)', async () => {
      // Skeleton / "no extractable text layer" / parse-error panel: the
      // container doesn't overflow, but there is nothing to read.
      const container = makeContainer({ scrollHeight: 800, clientHeight: 800 })
      const ref = { current: container }

      renderHook(() =>
        useAutoTrack('sec-1', false, vi.fn(), { current: null }, ref, 'text', undefined, false),
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read when content that fits has rendered', async () => {
      const container = makeContainer({ scrollHeight: 800, clientHeight: 800 })
      const ref = { current: container }

      renderHook(() =>
        useAutoTrack('sec-1', false, vi.fn(), { current: null }, ref, 'text', undefined, true),
      )

      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('marks read once contentReady flips from false to true', async () => {
      const container = makeContainer({ scrollHeight: 800, clientHeight: 800 })
      const ref = { current: container }

      const { rerender } = renderHook(
        ({ ready }: { ready: boolean }) =>
          useAutoTrack('sec-1', false, vi.fn(), { current: null }, ref, 'text', undefined, ready),
        { initialProps: { ready: false } },
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()

      rerender({ ready: true })
      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('still marks read on scroll-to-bottom even before content is flagged ready', async () => {
      // Overflowing container: the fits shortcut never applies, so the genuine
      // read signal must keep working untouched.
      const container = makeContainer({ scrollHeight: 2000, clientHeight: 800 })
      const ref = { current: container }

      renderHook(() =>
        useAutoTrack('sec-1', false, vi.fn(), { current: null }, ref, 'text', undefined, false),
      )

      // Let the listener attach.
      await settle(50)

      Object.defineProperty(container, 'scrollTop', { value: 1200, configurable: true })
      await act(async () => {
        container.dispatchEvent(new Event('scroll'))
        for (let i = 0; i < 10; i++) await Promise.resolve()
      })

      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })
  })

  describe('pdf mode (endofpage)', () => {
    it('does NOT mark read while the PDF container has no rendered pages', async () => {
      const container = makeContainer({ scrollHeight: 800, clientHeight: 800 })
      const ref = { current: container }

      renderHook(() =>
        useAutoTrack('sec-1', false, vi.fn(), { current: null }, undefined, 'pdf', ref),
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read once a page wrapper is appended', async () => {
      const container = makeContainer({ scrollHeight: 800, clientHeight: 800 })
      const ref = { current: container }

      renderHook(() =>
        useAutoTrack('sec-1', false, vi.fn(), { current: null }, undefined, 'pdf', ref),
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()

      const page = document.createElement('div')
      page.dataset.pageNum = '1'
      container.appendChild(page)

      await settle(1000)
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })
  })
})
