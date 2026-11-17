'use client'

import { useCallback, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useShortcut } from '@/hooks/use-shortcuts'
import { ShortcutHelpDialog } from '@/components/shortcut-help-dialog'

/**
 * Registers app-wide navigation shortcuts:
 * - Ctrl+,  → Open settings
 * - Ctrl+]  → Open keyboard customization
 * - ?       → Search shortcuts (KAN-407)
 */
export function GlobalNavigationShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const [helpOpen, setHelpOpen] = useState(false)

  const openSettings = useCallback(() => {
    if (pathname !== '/settings') {
      router.push('/settings')
    }
  }, [router, pathname])

  const openKeymap = useCallback(() => {
    router.push('/settings?tab=keymap')
  }, [router])

  const toggleHelp = useCallback(() => {
    setHelpOpen(open => !open)
  }, [])

  useShortcut('open-settings', 'Open Settings', 'Ctrl+,', openSettings)
  useShortcut('open-keymap', 'Keyboard Shortcuts', 'Ctrl+]', openKeymap)
  useShortcut('shortcut-help', 'Search Shortcuts', 'Shift+?', toggleHelp)

  return <ShortcutHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
}
