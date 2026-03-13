'use client'

import { type ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ShortcutProvider } from '@/hooks/use-shortcuts'
import { SyncProvider } from '@/components/sync-provider'

/**
 * Client-side providers wrapper.
 * Wraps the entire app with:
 * - SessionProvider (NextAuth session)
 * - TooltipProvider (for all tooltips)
 * - ShortcutProvider (for customizable keyboard shortcuts)
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <SyncProvider>
        <ShortcutProvider>
          <TooltipProvider delayDuration={200}>
            {children}
          </TooltipProvider>
        </ShortcutProvider>
      </SyncProvider>
    </SessionProvider>
  )
}
