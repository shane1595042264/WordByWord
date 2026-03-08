'use client'

import { useEffect, useRef, type RefObject } from 'react'

export function useAutoTrack(
  sectionId: string,
  isRead: boolean,
  onMarkedRead: () => void,
  scrollContainerRef: RefObject<HTMLDivElement | null>,
  /** Optional separate scroll container for text mode — forces endofpage tracking */
  textScrollRef?: RefObject<HTMLDivElement | null>,
  /** Current view mode — triggers re-evaluation when switching */
  viewMode?: string,
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
        await sectionRepo.markAsRead(sectionId)
        onMarkedRead()
      }

      const isTextMode = viewMode === 'text'

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
          setTimeout(() => {
            if (!cancelled) handleScroll()
          }, 1500)
          scrollCleanupRef.current = () => container.removeEventListener('scroll', handleScroll)
        }

        attachScroll()
      } else if (settings.trackingMode === 'endofpage') {
        // End-of-page mode for non-text views
        const container = scrollContainerRef.current
        if (!container) return

        const handleScroll = () => {
          const { scrollTop, scrollHeight, clientHeight } = container
          if (scrollTop + clientHeight >= scrollHeight - 50) {
            markRead('pdf-endofpage')
            container.removeEventListener('scroll', handleScroll)
          }
        }

        container.addEventListener('scroll', handleScroll)
        handleScroll()
        scrollCleanupRef.current = () => container.removeEventListener('scroll', handleScroll)
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
  }, [sectionId, isRead, onMarkedRead, scrollContainerRef, textScrollRef, viewMode])
}
