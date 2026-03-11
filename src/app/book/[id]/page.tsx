'use client'

import { use } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useBookDetail } from '@/hooks/use-book-detail'
import { ProgressDrilldown } from '@/components/dashboard/progress-drilldown'
import { ProcessButton } from '@/components/dashboard/process-button'

export default function BookDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { book, loading, refresh } = useBookDetail(id)

  if (loading) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  if (!book) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p>Book not found.</p>
        <Link href="/"><Button variant="outline" className="mt-4">Back to Library</Button></Link>
      </div>
    )
  }

  // Continue Reading: prefer the last-accessed section (tracks actual reading position)
  // Falls back to the old heuristic (last read → first unread) for books without saved position
  const lastAccessedSection = book.lastAccessedSectionId
    ? book.allSections.find(s => s.id === book.lastAccessedSectionId)
    : null
  const lastReadSection = [...book.allSections]
    .filter(s => s.isRead)
    .sort((a, b) => (b.readAt ?? 0) - (a.readAt ?? 0))[0]
  const firstUnreadSection = book.allSections.find(s => !s.isRead)
  const continueSection = lastAccessedSection ?? lastReadSection ?? firstUnreadSection

  // Build URL with position restore params
  const continueSectionUrl = continueSection
    ? (() => {
        const base = `/book/${book.id}/read/${continueSection.id}`
        // Only include restore params if this is the last-accessed section
        if (lastAccessedSection && continueSection.id === lastAccessedSection.id) {
          const params = new URLSearchParams()
          if (book.lastAccessedScrollProgress != null) {
            params.set('sp', String(book.lastAccessedScrollProgress))
          }
          if (book.lastAccessedWordIndex != null) {
            params.set('wi', String(book.lastAccessedWordIndex))
          }
          const qs = params.toString()
          return qs ? `${base}?${qs}` : base
        }
        return base
      })()
    : null

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <Link href="/" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">
        ← Back to Library
      </Link>

      <div className="flex gap-6 mb-8">
        <div className="w-32 h-44 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
          {book.coverImage ? (
            <img src={book.coverImage} alt={book.title} className="object-cover w-full h-full rounded-lg" />
          ) : (
            <span className="text-5xl">📖</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold">{book.title}</h1>
          <p className="text-muted-foreground">{book.author}</p>
          <div className="flex gap-2 mt-1">
            <Badge variant="outline">{book.totalPages} pages</Badge>
            <Badge variant="outline">{book.chapters.length} chapters</Badge>
            <Badge variant="outline">{book.allSections.length} sections</Badge>
          </div>
          {continueSection && continueSectionUrl && (
            <Link href={continueSectionUrl} className="mt-2">
              <Button>Continue Reading</Button>
            </Link>
          )}
          {book.processingStatus !== 'complete' && (
            <ProcessButton bookId={book.id} totalChapters={book.chapters.length} onComplete={refresh} />
          )}
        </div>
      </div>

      <ProgressDrilldown book={book} />
    </div>
  )
}
