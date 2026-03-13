'use client'

import { BookCard } from './book-card'
import type { BookWithProgress } from '@/hooks/use-books'

interface LibraryGridProps {
  books: BookWithProgress[]
  editMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string, event?: React.MouseEvent) => void
}

export function LibraryGrid({ books, editMode, selectedIds, onToggleSelect }: LibraryGridProps) {
  if (books.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <span className="text-6xl mb-4">📚</span>
        <p className="text-lg">No books yet</p>
        <p className="text-sm">Upload a PDF to get started</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {books.map(book => (
        <BookCard
          key={book.id}
          book={book}
          editMode={editMode}
          selected={selectedIds?.has(book.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  )
}
