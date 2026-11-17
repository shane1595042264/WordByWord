'use client'

import { use, useState, useEffect, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeftIcon, ArrowRightIcon, PencilIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AppHeader } from '@/components/app-header'
import { TypographicCover } from '@/components/library/typographic-cover'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBookDetail } from '@/hooks/use-book-detail'
import { ProgressDrilldown } from '@/components/dashboard/progress-drilldown'
import { ProcessButton } from '@/components/dashboard/process-button'
import { attachSectionsToChapters, buildChaptersFromDividers } from '@/components/dashboard/chapter-accordion'
import type { Divider } from '@/components/editor/page-strip-editor'

export default function BookDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { book, loading, error, refresh } = useBookDetail(id)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingCover, setGeneratingCover] = useState(false)
  const [showChapterEditor, setShowChapterEditor] = useState(false)
  const [coverError, setCoverError] = useState(false)

  // Reset cover error state when the URL changes so sync recoveries re-attempt the load
  useEffect(() => {
    setCoverError(false)
  }, [book?.coverImage])

  const startEditing = useCallback(() => {
    if (!book) return
    setEditTitle(book.title)
    setEditAuthor(book.author)
    setEditing(true)
  }, [book])

  const cancelEditing = useCallback(() => {
    setEditing(false)
  }, [])

  const saveEdits = useCallback(async () => {
    if (!book) return
    setSaving(true)
    try {
      const { BookRepository } = await import('@/lib/repositories')
      const bookRepo = new BookRepository()
      const result = await bookRepo.updateDetails(book.id, {
        title: editTitle.trim() || book.title,
        author: editAuthor.trim(),
      })
      if (result.backendSyncFailed) {
        toast.warning('Saved locally — cloud sync failed, will retry')
      }
    } catch (err) {
      console.error('Failed to save book details:', err)
      toast.error('Failed to save book details')
    } finally {
      setEditing(false)
      setSaving(false)
      refresh()
    }
  }, [book, editTitle, editAuthor, refresh])

  if (loading) {
    return (
      <div className="min-h-[100dvh]">
        <AppHeader current="library" />
        <main className="mx-auto max-w-5xl px-4 pt-10 sm:px-6" aria-busy="true">
          <span className="sr-only">Loading...</span>
          <div className="flex flex-col gap-8 sm:flex-row">
            <Skeleton className="aspect-[3/4] w-32 rounded-sm sm:w-44" />
            <div className="flex-1 space-y-3 pt-2">
              <Skeleton className="h-9 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-6 h-12 w-full max-w-xs" />
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-[100dvh]">
        <AppHeader current="library" />
        <div role="alert" className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Failed to load book</h2>
          <p className="text-muted-foreground text-center max-w-md">{error}</p>
          <div className="flex gap-2">
            <Button onClick={() => { refresh() }}>Try Again</Button>
            <Button variant="outline" asChild><Link href="/">Back to Library</Link></Button>
          </div>
        </div>
      </div>
    )
  }

  if (!book) {
    return (
      <div className="min-h-[100dvh]">
        <AppHeader current="library" />
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-4 text-center">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Book not found</h2>
          <p className="max-w-md text-muted-foreground">It may have been deleted, or it has not synced to this device yet.</p>
          <Button variant="outline" asChild><Link href="/">Back to Library</Link></Button>
        </div>
      </div>
    )
  }

  const sectionsRead = book.allSections.filter(s => s.isRead).length
  const sectionsTotal = book.allSections.length
  const percentRead = sectionsTotal > 0 ? Math.round((sectionsRead / sectionsTotal) * 100) : 0

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
    <div className="min-h-[100dvh]">
    <AppHeader current="library" />
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Back to Library
      </Link>

      <div className="mb-12 flex flex-col items-center gap-8 sm:flex-row sm:items-start">
        <div className="relative flex aspect-[3/4] w-36 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted shadow-[0_2px_4px_oklch(0.22_0.04_170/0.12),0_22px_40px_-18px_oklch(0.22_0.04_170/0.6)] ring-1 ring-black/5 dark:ring-white/10 sm:w-44">
          {book.coverImage && !coverError ? (
            <img
              src={book.coverImage}
              alt={book.title}
              className="object-cover w-full h-full"
              onError={() => setCoverError(true)}
            />
          ) : book.coverImage && coverError ? (
            <TypographicCover title={book.title} author={book.author} size="lg" />
          ) : (
            <div className="absolute inset-0">
              <TypographicCover title={book.title} author={book.author} size="lg" />
              <div className="absolute inset-x-0 bottom-0 flex justify-center p-2">
              <Button
                size="xs"
                variant="outline"
                className="text-[11px] px-2 py-1 shadow-sm"
                disabled={generatingCover}
                onClick={async () => {
                  if (!book) return
                  setGeneratingCover(true)
                  let coverSet = false
                  try {
                    // Try 1: render page 1 from PDF blob
                    if (book.pdfBlob) {
                      const { PDFService } = await import('@/lib/services/pdf-service')
                      const pdfSvc = new PDFService()
                      const cover = await pdfSvc.renderPageToImage(book.pdfBlob, 1, 1.5)
                      if (cover) {
                        const { db } = await import('@/lib/db/database')
                        await db.books.update(book.id, { coverImage: cover, updatedAt: Date.now() })
                        // Auto-sync will push coverUrl to backend on next sync cycle
                        const { syncService } = await import('@/lib/services/sync-service')
                        syncService.markDirty()
                        coverSet = true
                      }
                    }
                    // Try 2: Google Books cover via backend (only if PDF path didn't produce a cover)
                    if (!coverSet) {
                      const tokenRes = await fetch('/api/auth/token')
                      if (tokenRes.ok) {
                        const { token } = await tokenRes.json()
                        const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
                        const res = await fetch(`${apiUrl}/books/${book.remoteId}/summary`, {
                          headers: { Authorization: `Bearer ${token}` },
                        })
                        if (res.ok) {
                          const data = await res.json()
                          if (data.catalog?.coverUrl) {
                            const { db } = await import('@/lib/db/database')
                            await db.books.update(book.id, { coverImage: data.catalog.coverUrl, updatedAt: Date.now() })
                            coverSet = true
                          }
                        }
                      }
                    }
                    if (coverSet) {
                      refresh()
                    } else {
                      toast.info('No cover available — you can upload one manually')
                    }
                  } catch (err) {
                    console.error('Failed to generate cover:', err)
                    toast.error('Failed to generate cover')
                  } finally {
                    setGeneratingCover(false)
                  }
                }}
              >
                {generatingCover ? 'Generating...' : 'Generate Cover'}
              </Button>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1 min-w-0 items-center sm:items-start text-center sm:text-left w-full sm:pt-1">
          {editing ? (
            <>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Book title"
                aria-label="Book title"
                className="font-display text-3xl font-semibold tracking-tight bg-transparent border-b-2 border-primary outline-none pb-1 w-full"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveEdits(); if (e.key === 'Escape') cancelEditing() }}
              />
              <input
                type="text"
                value={editAuthor}
                onChange={e => setEditAuthor(e.target.value)}
                placeholder="Author"
                aria-label="Author"
                className="text-muted-foreground bg-transparent border-b border-muted-foreground/30 focus:border-primary outline-none pb-1 w-full"
                onKeyDown={e => { if (e.key === 'Enter') saveEdits(); if (e.key === 'Escape') cancelEditing() }}
              />
              <div className="flex gap-2 mt-1">
                <Button size="sm" onClick={saveEdits} disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEditing} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2 group">
                <h1 className="font-display text-3xl font-semibold leading-[1.1] tracking-tight md:text-4xl">{book.title}</h1>
                <button
                  onClick={startEditing}
                  className="mt-2 shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity text-muted-foreground hover:bg-accent hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  aria-label="Edit book details"
                  title="Edit book details"
                >
                  <PencilIcon aria-hidden="true" className="size-4" />
                </button>
              </div>
              <p className="text-lg text-muted-foreground">{book.author || 'Unknown'}</p>
            </>
          )}
          <dl className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm text-muted-foreground sm:justify-start">
            <div className="flex gap-1.5"><dt className="sr-only">Pages</dt><dd><span className="font-medium tabular-nums text-foreground">{book.totalPages}</span> pages</dd></div>
            <div className="flex gap-1.5"><dt className="sr-only">Chapters</dt><dd><span className="font-medium tabular-nums text-foreground">{book.chapters.length}</span> chapters</dd></div>
            <div className="flex gap-1.5"><dt className="sr-only">Sections</dt><dd><span className="font-medium tabular-nums text-foreground">{book.allSections.length}</span> sections</dd></div>
          </dl>
          {sectionsTotal > 0 && (
            <div className="mt-3 w-full max-w-sm">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">
                  {book.completedAt ? 'Finished' : `${sectionsRead} of ${sectionsTotal} sections read`}
                </span>
                <span className="font-display text-lg font-semibold tabular-nums">{percentRead}%</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percentRead}%` }} />
              </div>
            </div>
          )}
          {continueSection && continueSectionUrl && (() => {
            // Use last-accessed scroll progress if this is the last-accessed section,
            // otherwise fall back to section's own scrollProgress
            const sectionProgress = (lastAccessedSection && continueSection.id === lastAccessedSection.id)
              ? (book.lastAccessedScrollProgress ?? continueSection.scrollProgress ?? 0)
              : (continueSection.isRead ? 100 : (continueSection.scrollProgress ?? 0))
            return (
              <Button asChild className="group/continue mt-5 w-full sm:max-w-sm flex items-center gap-3 h-auto py-3 pl-4 pr-3 text-left">
                <Link href={continueSectionUrl}>
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="text-sm font-semibold">Continue Reading</span>
                    <span className="text-xs opacity-80 truncate w-full text-left font-normal">{continueSection.title}</span>
                    <span className="mt-1 block h-1 w-full rounded-full bg-primary-foreground/25">
                      <span
                        className="block h-1 rounded-full bg-primary-foreground transition-[width]"
                        style={{ width: `${Math.min(100, Math.max(0, sectionProgress))}%` }}
                      />
                    </span>
                  </span>
                  <ArrowRightIcon aria-hidden="true" className="size-5 shrink-0 transition-transform group-hover/continue:translate-x-0.5 motion-reduce:transition-none" />
                </Link>
              </Button>
            )
          })()}
          {book.processingStatus !== 'complete' && (
            <ProcessButton bookId={book.id} totalChapters={book.chapters.length} onComplete={refresh} />
          )}
        </div>
      </div>

      <ProgressDrilldown book={book} onReorganize={book.totalPages > 0 && book.pdfBlob && book.remoteId ? () => setShowChapterEditor(true) : undefined} />

      {/* Chapter reorganize dialog */}
      <Dialog open={showChapterEditor} onOpenChange={setShowChapterEditor}>
        <DialogContent className="max-w-[95vw] max-h-[80vh] overflow-hidden" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reorganize Chapters</DialogTitle>
          </DialogHeader>
          {showChapterEditor && book.pdfBlob && book.remoteId && (() => {
            // Lazy import to avoid SSR issues with pdf.js
            const PageStripEditor = require('@/components/editor/page-strip-editor').PageStripEditor
            const existingDividers: Divider[] = book.chapters
              .filter(ch => ch.startPage > 1)
              .map(ch => ({ page: ch.startPage, title: ch.title }))

            return (
              <PageStripEditor
                pdfBlob={book.pdfBlob}
                startPage={1}
                endPage={book.totalPages}
                totalBookPages={book.totalPages}
                bookRemoteId={book.remoteId!}
                existingDividers={existingDividers}
                level="chapter"
                onSave={async (dividers: Divider[]) => {
                  const { StructureService, StaleBookError } = await import('@/lib/services/structure-service')
                  const svc = new StructureService()
                  const finalChapters = attachSectionsToChapters(
                    buildChaptersFromDividers(book.chapters, book.totalPages, dividers),
                    book.chapters
                  )

                  try {
                    await svc.saveStructure(book.remoteId!, finalChapters)
                  } catch (err) {
                    if (err instanceof StaleBookError) {
                      toast.error(err.message)
                    } else {
                      toast.error(err instanceof Error ? err.message : 'Failed to save chapters')
                    }
                    return
                  }
                  // Force sync and refresh. Wait out any in-flight sync — a plain sync() would
                  // skip and refresh() would re-read the old chapters (KAN-360).
                  const { syncService } = await import('@/lib/services/sync-service')
                  syncService.markDirty()
                  await syncService.syncAfterInFlight()
                  setShowChapterEditor(false)
                  refresh()
                }}
                onClose={() => setShowChapterEditor(false)}
              />
            )
          })()}
        </DialogContent>
      </Dialog>
    </main>
    </div>
  )
}

