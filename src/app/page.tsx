'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { useBooks } from '@/hooks/use-books'
import { LibraryGrid } from '@/components/library/library-grid'
import { UploadDialog } from '@/components/library/upload-dialog'
import { Button } from '@/components/ui/button'

export default function HomePage() {
  const { books, loading, refresh } = useBooks()

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Bit by Bit</h1>
          <p className="text-muted-foreground">Your reading progress, section by section</p>
        </div>
        <div className="flex gap-2">
          <UploadDialog onBookImported={refresh} />
          <Link href="/vocabulary">
            <Button variant="outline">Vocabulary</Button>
          </Link>
          <Link href="/settings">
            <Button variant="outline">Settings</Button>
          </Link>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
      ) : (
        <LibraryGrid books={books} />
      )}
    </div>
  )
}
