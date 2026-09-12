'use client'

import { useEffect, useRef, type RefObject } from 'react'

/** How long to let content render before the first fits/bottom check. */
const INITIAL_CHECK_DELAY_MS = 1500
/** Poll interval while the scroll container still has nothing rendered in it. */
const RENDER_WAIT_INTERVAL_MS = 500
/** Give up waiting after ~30s so we don't poll forever on a broken render. */
const MAX_RENDER_WAIT_ATTEMPTS = 60

export function useAutoTrack(
  sectionId: string,
  isRead: boolean,
  onMarkedRead: (bookJustCompleted: boolean) => void,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  /** Optional separate scroll container for text mode — forces endofpage tracking */
  textScrollRef?: RefObject<HTMLDivElement | null>,
  /** Current view mode — triggers re-evaluation when switching */
  viewMode?: string,
  /** Optional separate scroll container for PDF mode */
  pdfScrollRef?: RefObject<HTMLDivElement | null>,
  /**
   * Whether the content for the current view mode has actually rendered.
   * Pass `false` while a skeleton, an error panel or an empty state is on
   * screen — a container showing one of those doesn't overflow either, and
   * without this the "fits without scroll" shortcut would mark the section
   * read even though there was nothing to read. Defaults to `true` so callers
   * that can't determine readiness keep the previous behaviour.
   */
  contentReady: boolean = true,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (isRead) return

    let cancelled = false

    const setup = async () => {
      const { SectionRepository } = await import('@/lib/repositories')
      const { SettingsService } = await import('@/lib/services/settings-service')
      const sectionRepo = new SectionRepository()
      const settingsService = new SettingsService()
      const settings = settingsService.getSettings()

      const markRead = async (_reason: string) => {
        if (cancelled) return
        const bookJustCompleted = await sectionRepo.markAsRead(sectionId)
        onMarkedRead(bookJustCompleted)
      }

      const isTextMode = viewMode === 'text'

      /**
       * Has the container actually got rendered section content in it?
       *
       * `maxScroll < 10` on its own means "this pane doesn't overflow", which
       * is equally true of a skeleton, a "no extractable text layer" empty
       * state, a parse-error panel, and a PDF container whose pages haven't
       * been appended yet. Only the fits-without-scroll shortcut consults
       * this — scrolling to the bottom is a genuine read signal either way.
       */
      const hasRenderedContent = (container: HTMLElement) => {
        if (!contentReady) return false
        // PDFViewer builds its scroll container imperatively and appends one
        // [data-page-num] wrapper per page, so an empty container means pdf.js
        // hasn't rendered anything yet.
        if (viewMode === 'pdf') return container.querySelector('[data-page-num]') !== null
        return true
      }

      /**
       * Run the initial fits/bottom check once content has had a chance to
       * render. If the container is still empty we retry instead of firing
       * (and instead of giving up for good — a slow PDF that fits without
       * scrolling should still auto-mark once its pages appear).
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

      // In text mode, ALWAYS use scroll-based tracking regardless of settings
      if (isTextMode) {
        // Wait for the text scroll container to be available
        const attachScroll = () => {
          if (cancelled) return
          const container = textScrollRef?.current
          if (!container) {
            // Retry — the div may not be rendered yet
            timerRef.current = setTimeout(attachScroll, 200)
            return
          }

          const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container
            const maxScroll = scrollHeight - clientHeight
            if (maxScroll < 10) {
              // Nothing rendered yet (or nothing renderable at all) — don't
              // treat "doesn't overflow" as "read", and stay attached so a
              // later check can still mark it.
              if (!hasRenderedContent(container)) return
              markRead('text-fits-without-scroll')
              container.removeEventListener('scroll', handleScroll)
              return
            }
            if (scrollTop + clientHeight >= scrollHeight - 50) {
              markRead('text-scrolled-to-bottom')
              container.removeEventListener('scroll', handleScroll)
            }
          }

          container.addEventListener('scroll', handleScroll)
          // Delay initial check to let content fully render
          scheduleInitialCheck(container, handleScroll)
          scrollCleanupRef.current = () => container.removeEventListener('scroll', handleScroll)
        }

        attachScroll()
      } else if (settings.trackingMode === 'endofpage') {
        // End-of-page mode for non-text views
        // For PDF mode, use the dedicated PDF scroll container instead of the outer wrapper
        const targetRef = viewMode === 'pdf' && pdfScrollRef ? pdfScrollRef : scrollContainerRef

        const attachScroll = () => {
          if (cancelled) return
          const container = targetRef.current
          if (!container) {
            // Retry — the scroll container may not be rendered yet
            timerRef.current = setTimeout(attachScroll, 200)
            return
          }

          const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = container
            const maxScroll = scrollHeight - clientHeight
            if (maxScroll < 10) {
              if (!hasRenderedContent(container)) return
              markRead('pdf-endofpage-fits')
              container.removeEventListener('scroll', handleScroll)
              return
            }
            if (scrollTop + clientHeight >= scrollHeight - 50) {
              markRead('pdf-endofpage')
              container.removeEventListener('scroll', handleScroll)
            }
          }

          container.addEventListener('scroll', handleScroll)
          // Delay initial check to let content fully render
          scheduleInitialCheck(container, handleScroll)
          scrollCleanupRef.current = () => container.removeEventListener('scroll', handleScroll)
        }

        attachScroll()
      } else {
        // Timer mode: mark as read after threshold seconds (non-text modes only)
        const threshold = settings.autoReadThresholdSeconds * 1000
        timerRef.current = setTimeout(() => markRead('timer'), threshold)
      }
    }

    setup()

    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = null
      scrollCleanupRef.current?.()
      scrollCleanupRef.current = null
    }
  }, [sectionId, isRead, onMarkedRead, scrollContainerRef, textScrollRef, viewMode, pdfScrollRef, contentReady])
}
