'use client'

import { useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useShortcut } from '@/hooks/use-shortcuts'

/**
 * Registers app-wide navigation shortcuts:
 * - Ctrl+,  → Open settings
 * - Ctrl+]  → Open keyboard customization
 */
export function GlobalNavigationShortcuts() {
  const router = useRouter()
  const pathname = usePathname()

  const openSettings = useCallback(() => {
    if (pathname !== '/settings') {
      router.push('/settings')
    }
  }, [router, pathname])

  const openKeymap = useCallback(() => {
    router.push('/settings?tab=keymap')
  }, [router])

  useShortcut('open-settings', 'Open Settings', 'Ctrl+,', openSettings)
  useShortcut('open-keymap', 'Keyboard Shortcuts', 'Ctrl+]', openKeymap)

  return null
}
