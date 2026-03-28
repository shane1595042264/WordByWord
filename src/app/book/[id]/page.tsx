'use client'

import { use, useState, useCallback, useTransition } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useBookDetail } from '@/hooks/use-book-detail'
import { ProgressDrilldown } from '@/components/dashboard/progress-drilldown'
import { ProcessButton } from '@/components/dashboard/process-button'
import type { Divider } from '@/components/editor/page-strip-editor'

export default function BookDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { book, loading, refresh } = useBookDetail(id)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editAuthor, setEditAuthor] = useState('')
  const [saving, setSaving] = useState(false)
  const [generatingCover, setGeneratingCover] = useState(false)
  const [showChapterEditor, setShowChapterEditor] = useState(false)

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
    const { BookRepository } = await import('@/lib/repositories')
    const bookRepo = new BookRepository()
    await bookRepo.updateDetails(book.id, {
      title: editTitle.trim() || book.title,
      author: editAuthor.trim(),
    })
    setEditing(false)
    setSaving(false)
    refresh()
  }, [book, editTitle, editAuthor, refresh])

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
        <div className="w-32 h-44 bg-muted rounded-lg flex items-center justify-center flex-shrink-0 relative overflow-hidden">
          {book.coverImage ? (
            <img src={book.coverImage} alt={book.title} className="object-cover w-full h-full rounded-lg" />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-5xl">📖</span>
              <Button
                size="xs"
                variant="outline"
                className="text-[10px] px-2 py-1"
                disabled={generatingCover}
                onClick={async () => {
                  if (!book) return
                  setGeneratingCover(true)
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
                        refresh()
                        setGeneratingCover(false)
                        return
                      }
                    }
                    // Try 2: Google Books cover via backend
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
                          refresh()
                        }
                      }
                    }
                  } catch { /* ignore */ }
                  setGeneratingCover(false)
                }}
              >
                {generatingCover ? 'Generating...' : 'Generate Cover'}
              </Button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 flex-1">
          {editing ? (
            <>
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                placeholder="Book title"
                className="text-2xl font-bold bg-transparent border-b border-primary outline-none pb-1"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveEdits(); if (e.key === 'Escape') cancelEditing() }}
              />
              <input
                type="text"
                value={editAuthor}
                onChange={e => setEditAuthor(e.target.value)}
                placeholder="Author"
                className="text-muted-foreground bg-transparent border-b border-muted-foreground/30 outline-none pb-1"
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
              <div className="flex items-center gap-2 group">
                <h1 className="text-2xl font-bold">{book.title}</h1>
                <button
                  onClick={startEditing}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  title="Edit book details"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                </button>
              </div>
              <p className="text-muted-foreground">{book.author || 'Unknown'}</p>
            </>
          )}
          <div className="flex gap-2 mt-1">
            <Badge variant="outline">{book.totalPages} pages</Badge>
            <Badge variant="outline">{book.chapters.length} chapters</Badge>
            <Badge variant="outline">{book.allSections.length} sections</Badge>
          </div>
          {continueSection && continueSectionUrl && (() => {
            // Use last-accessed scroll progress if this is the last-accessed section,
            // otherwise fall back to section's own scrollProgress
            const sectionProgress = (lastAccessedSection && continueSection.id === lastAccessedSection.id)
              ? (book.lastAccessedScrollProgress ?? continueSection.scrollProgress ?? 0)
              : (continueSection.isRead ? 100 : (continueSection.scrollProgress ?? 0))
            return (
              <Link href={continueSectionUrl} className="mt-3 block max-w-xs">
                <Button className="w-full flex flex-col items-start gap-1 h-auto py-2.5 px-4">
                  <span className="text-sm font-medium">Continue Reading</span>
                  <span className="text-xs opacity-80 truncate w-full text-left">{continueSection.title}</span>
                  <div className="w-full bg-primary-foreground/30 rounded-full h-1.5 mt-0.5">
                    <div
                      className="bg-primary-foreground rounded-full h-1.5 transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, sectionProgress))}%` }}
                    />
                  </div>
                </Button>
              </Link>
            )
          })()}
          {book.processingStatus !== 'complete' && (
            <ProcessButton bookId={book.id} totalChapters={book.chapters.length} onComplete={refresh} />
          )}
        </div>
      </div>

      <ProgressDrilldown book={book} onReorganize={() => setShowChapterEditor(true)} />

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
                  const { StructureService } = await import('@/lib/services/structure-service')
                  const svc = new StructureService()
                  const sorted = [...dividers].sort((a, b) => a.page - b.page)
                  const chapters: Array<{ title: string; startPage: number; endPage: number }> = []
                  let currentStart = 1
                  for (const div of sorted) {
                    chapters.push({
                      title: chapters.length === 0 ? (book.chapters[0]?.title || 'Chapter 1') : chapters[chapters.length - 1]?.title || 'Chapter',
                      startPage: currentStart,
                      endPage: div.page - 1,
                    })
                    currentStart = div.page
                  }
                  // Fix titles: each divider names the chapter that STARTS at that page
                  const finalChapters: Array<{ title: string; startPage: number; endPage: number }> = []
                  let cs = 1
                  for (let i = 0; i < sorted.length; i++) {
                    finalChapters.push({
                      title: i === 0 ? (book.chapters[0]?.title || 'Chapter 1') : sorted[i - 1].title,
                      startPage: cs,
                      endPage: sorted[i].page - 1,
                    })
                    cs = sorted[i].page
                  }
                  finalChapters.push({
                    title: sorted.length > 0 ? sorted[sorted.length - 1].title : 'Chapter 1',
                    startPage: cs,
                    endPage: book.totalPages,
                  })

                  await svc.saveStructure(book.remoteId!, finalChapters)
                  // Force sync and refresh
                  const { syncService } = await import('@/lib/services/sync-service')
                  syncService.markDirty()
                  await syncService.sync()
                  setShowChapterEditor(false)
                  refresh()
                }}
                onClose={() => setShowChapterEditor(false)}
              />
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
