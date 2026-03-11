'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { startAutoSync, stopAutoSync } from '@/lib/services/sync-service'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()

  useEffect(() => {
    if (status === 'authenticated') {
      startAutoSync()
    } else {
      stopAutoSync()
    }

    return () => stopAutoSync()
  }, [status])

  return <>{children}</>
}
