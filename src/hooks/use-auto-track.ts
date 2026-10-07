'use client'

import { useEffect, useRef, type RefObject } from 'react'

/**
 * Auto-mark a section as read based on WHERE THE READER IS — never on how long
 * the section has been open.
 *
 * The rule (2026-10-06, NorthStar.md Section 0): a section is read when the
 * reader reaches the end of its content.
 *
 *   - `text` / `side-by-side` → the text pane (`textScrollRef`) is scrolled to
 *     within BOTTOM_THRESHOLD_PX of its bottom, or it fits on screen without
 *     scrolling at all — provided real content is what's on screen
 *     (`contentReady`), not a skeleton, an error panel or an empty state.
 *   - `pdf` + `scroll`       → the same two signals on the PDF pane
 *     (`pdfScrollRef`), and "rendered" additionally requires pdf.js to have
 *     appended at least one `[data-page-num]` page wrapper.
 *   - `pdf` + `flip`         → one page at a time inside an overflow-hidden
 *     box, so scroll position means nothing. The section is read once the page
 *     on screen is the section's LAST page (`pdfOnLastPage`) and that page has
 *     rendered.
 *
 * Why there is no timer any more: the old default (`trackingMode: 'timer'`)
 * marked a section read `autoReadThresholdSeconds` after it opened, wherever
 * the reader happened to be — "marked read when I'm 30% down the page". Time
 * spent says nothing about whether the content was reached, so timer mode was
 * retired and this hook no longer reads `SettingsService` at all. The
 * `trackingMode` / `autoReadThresholdSeconds` fields survive in `AppSettings`
 * purely so older clients' sync payloads keep round-tripping.
 *
 * Side-by-side used to watch the reader's outer `overflow-hidden` wrapper,
 * which never scrolls and so always looked like it "fit" — firing the shortcut
 * the moment the section opened. It now watches the text pane, like text view.
 */

/** How long to let content render before the first fits/bottom (or last-page) check. */
export const INITIAL_CHECK_DELAY_MS = 1500
/** Poll interval while the pane still has nothing rendered in it. */
export const RENDER_WAIT_INTERVAL_MS = 500
/** Give up waiting after ~30s so we don't poll forever on a broken render. */
export const MAX_RENDER_WAIT_ATTEMPTS = 60
/** Retry interval while the pane's scroll container hasn't mounted yet. */
export const REF_MOUNT_RETRY_MS = 200
/** A pane that overflows by less than this many px "fits without scrolling". */
export const FITS_WITHOUT_SCROLL_PX = 10
/** Scrolled to within this many px of the bottom counts as "reached the end". */
export const BOTTOM_THRESHOLD_PX = 50

/** Why a section was marked read — one per position signal. */
export type AutoTrackReason =
  | 'text-bottom'
  | 'text-fits'
  | 'pdf-scroll-bottom'
  | 'pdf-scroll-fits'
  | 'pdf-flip-last-page'

export interface UseAutoTrackOptions {
  sectionId: string
  isRead: boolean
  onMarkedRead: (bookJustCompleted: boolean) => void
  viewMode: 'pdf' | 'text' | 'side-by-side'
  readingMode: 'scroll' | 'flip'
  /** Scroll container of the text pane (text + side-by-side views). */
  textScrollRef: RefObject<HTMLDivElement | null>
  /** Scroll container of the PDF pane (pdf view). */
  pdfScrollRef: RefObject<HTMLDivElement | null>
  /** Whether the active pane shows real content (not a skeleton / error / empty state). */
  contentReady: boolean
  /** PDF flip mode only: true when the page on screen is the section's last page. */
  pdfOnLastPage: boolean
}

export function useAutoTrack({
  sectionId,
  isRead,
  onMarkedRead,
  viewMode,
  readingMode,
  textScrollRef,
  pdfScrollRef,
  contentReady,
  pdfOnLastPage,
}: UseAutoTrackOptions): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (isRead) return

    let cancelled = false
    let marked = false

    const isPdfView = viewMode === 'pdf'
    const isPdfFlip = isPdfView && readingMode === 'flip'
    // Text and side-by-side both read from the text pane. The PDF pane is only
    // the tracked surface when it is the only thing on screen.
    const paneRef = isPdfView ? pdfScrollRef : textScrollRef

    const clearTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const detachScroll = () => {
      scrollCleanupRef.current?.()
      scrollCleanupRef.current = null
    }

    const setup = async () => {
      const { SectionRepository } = await import('@/lib/repositories')
      const sectionRepo = new SectionRepository()

      const markRead = async (_reason: AutoTrackReason) => {
        if (cancelled || marked) return
        marked = true
        // One signal is enough: stop listening and drop any pending check so a
        // scroll-to-bottom followed by the initial check can't mark twice.
        clearTimer()
        detachScroll()
        const bookJustCompleted = await sectionRepo.markAsRead(sectionId)
        onMarkedRead(bookJustCompleted)
      }

      /**
       * Has the pane actually got rendered section content in it?
       *
       * `maxScroll < FITS_WITHOUT_SCROLL_PX` on its own means "this pane
       * doesn't overflow", which is equally true of a skeleton, a "no
       * extractable text layer" empty state, a parse-error panel, and a PDF
       * container whose pages haven't been appended yet. Only the
       * fits-without-scroll shortcut and the flip-mode last-page check consult
       * this — scrolling to the bottom is a genuine read signal either way.
       */
      const hasRenderedContent = (container: HTMLElement) => {
        if (!contentReady) return false
        // PDFViewer builds its scroll container imperatively and appends one
        // [data-page-num] wrapper per page, so an empty container means pdf.js
        // hasn't rendered anything yet.
        if (isPdfView) return container.querySelector('[data-page-num]') !== null
        return true
      }

      /**
       * Run `check` once content has had a chance to render. If the pane is
       * still empty we retry instead of firing (and instead of giving up for
       * good — a slow PDF that fits without scrolling should still auto-mark
       * once its pages appear).
       */
      const scheduleInitialCheck = (container: HTMLElement, check: () => void) => {
        let attempts = 0
        const run = () => {
          if (cancelled) return
          if (!hasRenderedContent(container)) {
            // `contentReady` is a hook input — the effect re-runs when it
            // flips, so only the DOM-driven wait needs polling here.
            if (!contentReady || attempts >= MAX_RENDER_WAIT_ATTEMPTS) return
            attempts++
            timerRef.current = setTimeout(run, RENDER_WAIT_INTERVAL_MS)
            return
          }
          check()
        }
        timerRef.current = setTimeout(run, INITIAL_CHECK_DELAY_MS)
      }

      /** Wait for the pane's scroll container to mount, then hand it over. */
      const whenMounted = (onContainer: (container: HTMLDivElement) => void) => {
        const attempt = () => {
          if (cancelled) return
          const container = paneRef.current
          if (!container) {
            // Retry — the div may not be rendered yet.
            timerRef.current = setTimeout(attempt, REF_MOUNT_RETRY_MS)
            return
          }
          onContainer(container)
        }
        attempt()
      }

      if (isPdfFlip) {
        // A single page in an overflow-hidden box: there is nothing to scroll,
        // so the only position signal is "which page". Not the last page →
        // nothing to do; `pdfOnLastPage` is a dep, so the effect re-runs (and
        // this run is cancelled) the moment the reader flips.
        if (!pdfOnLastPage) return
        whenMounted(container => {
          scheduleInitialCheck(container, () => markRead('pdf-flip-last-page'))
        })
        return
      }

      const [fitsReason, bottomReason]: [AutoTrackReason, AutoTrackReason] = isPdfView
        ? ['pdf-scroll-fits', 'pdf-scroll-bottom']
        : ['text-fits', 'text-bottom']

      whenMounted(container => {
        const handleScroll = () => {
          const { scrollTop, scrollHeight, clientHeight } = container
          const maxScroll = scrollHeight - clientHeight
          if (maxScroll < FITS_WITHOUT_SCROLL_PX) {
            // Nothing rendered yet (or nothing renderable at all) — don't
            // treat "doesn't overflow" as "read", and stay attached so a
            // later check can still mark it.
            if (!hasRenderedContent(container)) return
            markRead(fitsReason)
            return
          }
          if (scrollTop + clientHeight >= scrollHeight - BOTTOM_THRESHOLD_PX) {
            markRead(bottomReason)
          }
        }

        container.addEventListener('scroll', handleScroll)
        scrollCleanupRef.current = () => container.removeEventListener('scroll', handleScroll)
        // Delay the initial check to let content fully render.
        scheduleInitialCheck(container, handleScroll)
      })
    }

    setup()

    return () => {
      cancelled = true
      clearTimer()
      detachScroll()
    }
  }, [sectionId, isRead, onMarkedRead, viewMode, readingMode, textScrollRef, pdfScrollRef, contentReady, pdfOnLastPage])
}
