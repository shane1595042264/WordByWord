'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function BookError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Book page error:', error)
  }, [error])

  return (
    <div className="container mx-auto px-4 py-8 flex flex-col items-center gap-4">
      <h2 className="text-xl font-semibold">Failed to load book</h2>
      <p className="text-muted-foreground text-center max-w-md">
        Something went wrong while loading this book. The book may not exist or there was a network issue.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="outline">Back to Library</Button>
        </Link>
      </div>
    </div>
  )
}
