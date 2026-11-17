'use client'

import { LibraryIcon } from 'lucide-react'
import { BookCard } from './book-card'
import type { BookWithProgress } from '@/hooks/use-books'

interface LibraryGridProps {
  books: BookWithProgress[]
  editMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void
  onProcessingComplete?: () => void
}

export function LibraryGrid({ books, editMode, selectedIds, onToggleSelect, onProcessingComplete }: LibraryGridProps) {
  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-20 text-center">
        <div className="mb-5 grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
          <LibraryIcon aria-hidden="true" className="size-6" />
        </div>
        <p className="font-display text-xl font-semibold tracking-tight">No books yet</p>
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
          Upload a PDF to get started. EPUBs work too. Nibbler splits the book into sections you can track one by one.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {/* No entry animation: refresh() remounts every card after each sync,
          so one would replay all day. */}
      {books.map(book => (
        <BookCard
          key={book.id}
          book={book}
          editMode={editMode}
          selected={selectedIds?.has(book.id)}
          onToggleSelect={onToggleSelect}
          onProcessingComplete={onProcessingComplete}
        />
      ))}
    </div>
  )
}
