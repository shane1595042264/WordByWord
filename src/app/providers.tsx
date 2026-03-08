'use client'

import { type ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ShortcutProvider } from '@/hooks/use-shortcuts'

/**
 * Client-side providers wrapper.
 * Wraps the entire app with:
 * - TooltipProvider (for all tooltips)
 * - ShortcutProvider (for customizable keyboard shortcuts)
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ShortcutProvider>
      <TooltipProvider delayDuration={200}>
        {children}
      </TooltipProvider>
    </ShortcutProvider>
  )
}
