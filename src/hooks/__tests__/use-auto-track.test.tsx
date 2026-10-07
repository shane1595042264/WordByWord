import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoTrack, type UseAutoTrackOptions } from '../use-auto-track'

const markAsRead = vi.fn(async () => false)

vi.mock('@/lib/repositories', () => ({
  SectionRepository: class {
    markAsRead = markAsRead
  },
}))

/**
 * A stand-in for a text/PDF scroll container. jsdom doesn't lay anything out,
 * so scrollHeight/clientHeight are defined explicitly.
 */
function makeContainer({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: 0, configurable: true })
  document.body.appendChild(el)
  return el
}

/** An overflowing pane: 800px tall showing 2000px of content. */
const overflowing = () => makeContainer({ scrollHeight: 2000, clientHeight: 800 })
/** A pane whose content fits without scrolling. */
const fitting = () => makeContainer({ scrollHeight: 800, clientHeight: 800 })

/** Append a pdf.js-style page wrapper — what PDFViewer does once a page renders. */
function appendPage(container: HTMLElement, pageNum = 1) {
  const page = document.createElement('div')
  page.dataset.pageNum = String(pageNum)
  container.appendChild(page)
  return page
}

/** Move the scrollbar and fire the scroll event the hook listens for. */
async function scrollTo(container: HTMLElement, scrollTop: number) {
  Object.defineProperty(container, 'scrollTop', { value: scrollTop, configurable: true })
  await act(async () => {
    container.dispatchEvent(new Event('scroll'))
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

/** 30% of the way down `overflowing()` — far from the 50px bottom band. */
const THIRTY_PERCENT = 360
/** scrollTop + clientHeight (800) === scrollHeight (2000). */
const BOTTOM = 1200

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

/**
 * Well past anything the hook schedules — and double the retired timer's 5s
 * default, so "still not marked" here means the timer really is gone.
 */
async function advanceTenSeconds() {
  await settle(5000) // two passes → 10s of fake time
}

function opts(overrides: Partial<UseAutoTrackOptions> = {}): UseAutoTrackOptions {
  return {
    sectionId: 'sec-1',
    isRead: false,
    onMarkedRead: vi.fn(),
    viewMode: 'text',
    readingMode: 'scroll',
    textScrollRef: { current: null },
    pdfScrollRef: { current: null },
    contentReady: true,
    pdfOnLastPage: false,
    ...overrides,
  }
}

describe('useAutoTrack', () => {
  beforeEach(async () => {
    // Warm the module cache before the clock is faked: the hook resolves this
    // via dynamic import(), which doesn't settle under fake timers.
    await import('@/lib/repositories')
    vi.useFakeTimers()
    markAsRead.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  describe('text view', () => {
    it('does NOT mark read when the pane fits but no content has rendered (KAN-300)', async () => {
      // Skeleton / "no extractable text layer" / parse-error panel: the
      // container doesn't overflow, but there is nothing to read.
      const ref = { current: fitting() }

      renderHook(() => useAutoTrack(opts({ textScrollRef: ref, contentReady: false })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read when content that fits has rendered', async () => {
      const ref = { current: fitting() }

      renderHook(() => useAutoTrack(opts({ textScrollRef: ref, contentReady: true })))

      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('marks read once contentReady flips from false to true', async () => {
      const ref = { current: fitting() }

      const { rerender } = renderHook(
        ({ ready }: { ready: boolean }) => useAutoTrack(opts({ textScrollRef: ref, contentReady: ready })),
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
      const container = overflowing()

      renderHook(() => useAutoTrack(opts({ textScrollRef: { current: container }, contentReady: false })))

      // Let the listener attach.
      await settle(50)
      await scrollTo(container, BOTTOM)

      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('does NOT mark read part-way down an overflowing pane, however long it stays open', async () => {
      const container = overflowing()

      renderHook(() => useAutoTrack(opts({ textScrollRef: { current: container } })))

      await settle(50)
      await scrollTo(container, THIRTY_PERCENT)
      await advanceTenSeconds()

      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('keeps retrying until the text container mounts, then tracks it', async () => {
      const ref: { current: HTMLDivElement | null } = { current: null }

      renderHook(() => useAutoTrack(opts({ textScrollRef: ref })))

      // Nothing to attach to yet — the hook is polling the ref every 200ms.
      await settle(50)
      expect(markAsRead).not.toHaveBeenCalled()

      ref.current = fitting()
      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('calls onMarkedRead with the repository result exactly once', async () => {
      markAsRead.mockResolvedValueOnce(true)
      const onMarkedRead = vi.fn()
      const container = overflowing()

      renderHook(() => useAutoTrack(opts({ textScrollRef: { current: container }, onMarkedRead })))

      await settle(50)
      await scrollTo(container, BOTTOM)
      // A second scroll event at the bottom and the pending initial check must
      // not mark the same section again.
      await scrollTo(container, BOTTOM)
      await advancePastInitialCheck()

      expect(markAsRead).toHaveBeenCalledTimes(1)
      expect(onMarkedRead).toHaveBeenCalledTimes(1)
      expect(onMarkedRead).toHaveBeenCalledWith(true)
    })
  })

  describe('pdf view, scroll mode', () => {
    const pdfScroll = (over: Partial<UseAutoTrackOptions> = {}) =>
      opts({ viewMode: 'pdf', readingMode: 'scroll', ...over })

    it('does NOT mark read while the PDF container has no rendered pages', async () => {
      const ref = { current: fitting() }

      renderHook(() => useAutoTrack(pdfScroll({ pdfScrollRef: ref })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read once a page wrapper is appended', async () => {
      const container = fitting()

      renderHook(() => useAutoTrack(pdfScroll({ pdfScrollRef: { current: container } })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()

      appendPage(container)
      await settle(1000)
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('does NOT mark read when pages exist but the pane is not flagged ready', async () => {
      const container = fitting()
      appendPage(container)

      renderHook(() => useAutoTrack(pdfScroll({ pdfScrollRef: { current: container }, contentReady: false })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('does NOT mark read at 30% scroll, even after 10s (the regression the timer caused)', async () => {
      const container = overflowing()
      appendPage(container)
      // A fitting text pane sits alongside; if the hook watched the wrong pane
      // this would be marked read via the fits shortcut.
      const textRef = { current: fitting() }

      renderHook(() => useAutoTrack(pdfScroll({ pdfScrollRef: { current: container }, textScrollRef: textRef })))

      await settle(50)
      await scrollTo(container, THIRTY_PERCENT)
      await advanceTenSeconds()

      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read on scroll-to-bottom', async () => {
      const container = overflowing()
      appendPage(container)

      renderHook(() => useAutoTrack(pdfScroll({ pdfScrollRef: { current: container } })))

      await settle(50)
      await scrollTo(container, THIRTY_PERCENT)
      expect(markAsRead).not.toHaveBeenCalled()

      await scrollTo(container, BOTTOM)
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })
  })

  describe('side-by-side view', () => {
    const sideBySide = (over: Partial<UseAutoTrackOptions> = {}) =>
      opts({ viewMode: 'side-by-side', readingMode: 'scroll', ...over })

    it('watches the TEXT pane: 30% down is not read, the bottom is', async () => {
      const text = overflowing()
      // The PDF pane fits and has a rendered page — it would "fit" instantly
      // if the hook were watching it (or the old overflow-hidden wrapper).
      const pdf = fitting()
      appendPage(pdf)

      renderHook(() =>
        useAutoTrack(sideBySide({ textScrollRef: { current: text }, pdfScrollRef: { current: pdf } })),
      )

      await settle(50)
      await scrollTo(text, THIRTY_PERCENT)
      await advanceTenSeconds()
      expect(markAsRead).not.toHaveBeenCalled()

      await scrollTo(text, BOTTOM)
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('marks read when the text pane fits without scrolling and content is ready', async () => {
      const text = fitting()

      renderHook(() => useAutoTrack(sideBySide({ textScrollRef: { current: text } })))

      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('does NOT mark read when the text pane fits but is not flagged ready', async () => {
      const text = fitting()

      renderHook(() => useAutoTrack(sideBySide({ textScrollRef: { current: text }, contentReady: false })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })
  })

  describe('pdf view, flip mode', () => {
    const pdfFlip = (over: Partial<UseAutoTrackOptions> = {}) =>
      opts({ viewMode: 'pdf', readingMode: 'flip', ...over })

    it('never marks read while pdfOnLastPage is false — scroll position is meaningless', async () => {
      // Flip mode's page lives in an overflow-hidden box that "fits"; neither
      // that nor a stray scroll event may count as reaching the end.
      const container = fitting()
      appendPage(container)

      renderHook(() => useAutoTrack(pdfFlip({ pdfScrollRef: { current: container }, pdfOnLastPage: false })))

      await settle(50)
      await scrollTo(container, BOTTOM)
      await advanceTenSeconds()

      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('marks read once pdfOnLastPage flips to true', async () => {
      const container = fitting()
      appendPage(container)

      const { rerender } = renderHook(
        ({ last }: { last: boolean }) =>
          useAutoTrack(pdfFlip({ pdfScrollRef: { current: container }, pdfOnLastPage: last })),
        { initialProps: { last: false } },
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()

      rerender({ last: true })
      await advancePastInitialCheck()
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('waits for a rendered page before marking the last page read', async () => {
      const container = fitting()

      renderHook(() => useAutoTrack(pdfFlip({ pdfScrollRef: { current: container }, pdfOnLastPage: true })))

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()

      appendPage(container, 7)
      await settle(1000)
      expect(markAsRead).toHaveBeenCalledWith('sec-1')
    })

    it('does NOT mark the last page read while the pane is not flagged ready', async () => {
      const container = fitting()
      appendPage(container)

      renderHook(() =>
        useAutoTrack(pdfFlip({ pdfScrollRef: { current: container }, pdfOnLastPage: true, contentReady: false })),
      )

      await advancePastInitialCheck()
      expect(markAsRead).not.toHaveBeenCalled()
    })

    it('flipping away before the initial delay cancels the pending mark', async () => {
      const container = fitting()
      appendPage(container)

      const { rerender } = renderHook(
        ({ last }: { last: boolean }) =>
          useAutoTrack(pdfFlip({ pdfScrollRef: { current: container }, pdfOnLastPage: last })),
        { initialProps: { last: true } },
      )

      // Reader lands on the last page, then flips back before 1.5s elapse.
      await settle(200)
      rerender({ last: false })
      await advanceTenSeconds()

      expect(markAsRead).not.toHaveBeenCalled()
    })
  })

  describe('already read', () => {
    it('installs nothing when isRead is true', async () => {
      // A fitting, ready text pane — exactly the input that marks read when
      // isRead is false.
      const container = fitting()
      const addListener = vi.spyOn(container, 'addEventListener')

      renderHook(() => useAutoTrack(opts({ isRead: true, textScrollRef: { current: container } })))

      await advanceTenSeconds()
      await scrollTo(container, BOTTOM)

      expect(addListener).not.toHaveBeenCalled()
      expect(markAsRead).not.toHaveBeenCalled()
    })
  })

  describe('cleanup', () => {
    it('unmounting before the initial check drops the pending mark and the listener', async () => {
      const container = overflowing()
      const removeListener = vi.spyOn(container, 'removeEventListener')

      const { unmount } = renderHook(() => useAutoTrack(opts({ textScrollRef: { current: container } })))

      await settle(50)
      unmount()
      expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function))

      await scrollTo(container, BOTTOM)
      await advanceTenSeconds()
      expect(markAsRead).not.toHaveBeenCalled()
    })
  })
})
