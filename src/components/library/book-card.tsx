'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import type { BookWithProgress } from '@/hooks/use-books'

interface BookCardProps {
  book: BookWithProgress
  editMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string, event?: React.MouseEvent) => void
}

export function BookCard({ book, editMode, selected, onToggleSelect }: BookCardProps) {
  const content = (
    <Card
      className={`transition-all cursor-pointer h-full ${
        editMode
          ? selected
            ? 'ring-2 ring-primary shadow-lg scale-[0.97]'
            : 'hover:ring-1 hover:ring-muted-foreground/30'
          : 'hover:shadow-lg'
      }`}
      onClick={editMode ? (e: React.MouseEvent) => {
        e.preventDefault()
        onToggleSelect?.(book.id, e)
      } : undefined}
    >
      <CardContent className="p-4 flex flex-col gap-3 relative">
        {editMode && (
          <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-muted-foreground/40 bg-background'
          }`}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        )}
        <div className="aspect-[3/4] bg-muted rounded-md flex items-center justify-center overflow-hidden">
          {book.coverImage ? (
            <img src={book.coverImage} alt={book.title} className="object-cover w-full h-full" />
          ) : (
            <span className="text-4xl text-muted-foreground">📖</span>
          )}
        </div>
        <div className="space-y-1">
          <h3 className="font-semibold text-sm line-clamp-2">{book.title}</h3>
          <p className="text-xs text-muted-foreground">{book.author}</p>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{book.progress.percentage}%</span>
            <span>{book.progress.read}/{book.progress.total} sections</span>
          </div>
          <Progress value={book.progress.percentage} className="h-2" />
        </div>
        {book.processingStatus === 'processing' && (
          <Badge variant="secondary" className="text-xs w-fit">Processing...</Badge>
        )}
      </CardContent>
    </Card>
  )

  if (editMode) {
    return content
  }

  return (
    <Link href={`/book/${book.id}`}>
      {content}
    </Link>
  )
}
