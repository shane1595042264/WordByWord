'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { syncService } from '@/lib/services/sync-service'

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()

  useEffect(() => {
    if (status === 'authenticated') {
      syncService.init()
      return () => syncService.destroy()
    }
  }, [status])

  return <>{children}</>
}
