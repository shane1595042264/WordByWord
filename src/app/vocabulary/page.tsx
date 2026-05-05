'use client'

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { VocabEntry } from '@/lib/db/models'

const PER_BOOK_INITIAL = 100
const PER_BOOK_INCREMENT = 100

interface VocabRowProps {
  entry: VocabEntry
  isExpanded: boolean
  isDeleting: boolean
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

const VocabRow = memo(function VocabRow({ entry, isExpanded, isDeleting, onToggle, onDelete }: VocabRowProps) {
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden bg-card hover:bg-accent/5 transition-colors">
      {/* Main row */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer"
        onClick={() => onToggle(entry.id)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-base">{entry.word}</span>
            {entry.pronunciation && (
              <span className="text-xs text-muted-foreground/60 font-mono">
                {entry.pronunciation}
              </span>
            )}
          </div>
          <p className="text-sm text-foreground/80 mt-0.5">{entry.translation}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-muted-foreground/50">
            p.{entry.pageNumber}
          </p>
          {entry.reviewCount > 0 && (
            <p className="text-[10px] text-muted-foreground/40">
              reviewed {entry.reviewCount}x
            </p>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-muted-foreground/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-4 pb-3 pt-0 border-t border-border/30">
          <p className="text-xs text-muted-foreground/70 mt-2 mb-1 italic leading-relaxed">
            &ldquo;{entry.contextSentence}&rdquo;
          </p>
          <p className="text-[10px] text-muted-foreground/40 mb-2">
            {entry.sectionTitle} &middot; Page {entry.pageNumber}
          </p>
          {entry.explanation && (
            <p className="text-xs text-muted-foreground leading-relaxed mb-2 bg-muted/30 rounded p-2">
              {entry.explanation}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              disabled={isDeleting}
              onClick={(e) => {
                e.stopPropagation()
                onDelete(entry.id)
              }}
            >
              {isDeleting ? 'Removing...' : 'Remove'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
})

export default function VocabularyPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [perBookLimits, setPerBookLimits] = useState<Record<string, number>>({})

  const loadEntries = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const { VocabService } = await import('@/lib/services/vocab-service')
      const svc = new VocabService()
      const all = await svc.getAll()
      setEntries(all)
    } catch (err) {
      console.error('Failed to load vocabulary entries', err)
      setLoadError(true)
      toast.error('Failed to load vocabulary. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const { VocabService } = await import('@/lib/services/vocab-service')
      const svc = new VocabService()
      await svc.delete(id)
      setEntries(prev => prev.filter(e => e.id !== id))
    } catch {
      toast.error('Failed to delete word. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }, [])

  const handleToggle = useCallback((id: string) => {
    setExpandedId(prev => (prev === id ? null : id))
  }, [])

  // Precompute lowercase searchable string per entry once per entries change.
  // Newline separator is safe — the search Input is single-line and cannot contain it.
  const searchableEntries = useMemo(
    () => entries.map(entry => ({
      entry,
      searchable: `${entry.word}\n${entry.translation}\n${entry.bookTitle}`.toLowerCase(),
    })),
    [entries]
  )

  const filtered = useMemo(() => {
    if (!deferredSearch) return entries
    const q = deferredSearch.toLowerCase()
    return searchableEntries
      .filter(({ searchable }) => searchable.includes(q))
      .map(({ entry }) => entry)
  }, [entries, deferredSearch, searchableEntries])

  const grouped = useMemo(() => {
    const map = new Map<string, VocabEntry[]>()
    for (const entry of filtered) {
      const key = entry.bookTitle || 'Unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(entry)
    }
    return map
  }, [filtered])

  // Reset per-book caps when the search filter changes — kept stable across
  // deletes so removing one entry doesn't collapse an already-expanded list.
  useEffect(() => {
    setPerBookLimits({})
  }, [deferredSearch])

  const showMore = useCallback((bookTitle: string) => {
    setPerBookLimits(prev => ({
      ...prev,
      [bookTitle]: (prev[bookTitle] ?? PER_BOOK_INITIAL) + PER_BOOK_INCREMENT,
    }))
  }, [])

  if (loading) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading vocabulary...</div>
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <Link href="/" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">
        &larr; Back to Library
      </Link>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Vocabulary Book</h1>
        <span className="text-sm text-muted-foreground">{entries.length} words</span>
      </div>

      {loadError ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-2">Couldn&rsquo;t load vocabulary</p>
          <p className="text-sm mb-4">Something went wrong reading your saved words.</p>
          <Button variant="outline" size="sm" onClick={loadEntries}>
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-2">No words saved yet</p>
          <p className="text-sm">Select a word while reading and press "Add to vocab" to save it here.</p>
        </div>
      ) : (
        <>
          <Input
            placeholder="Search words, translations, or books..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mb-6"
          />

          {[...grouped.entries()].map(([bookTitle, bookEntries]) => {
            const limit = perBookLimits[bookTitle] ?? PER_BOOK_INITIAL
            const visible = bookEntries.length > limit ? bookEntries.slice(0, limit) : bookEntries
            const remaining = bookEntries.length - visible.length
            return (
              <div key={bookTitle} className="mb-8">
                <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
                  {bookTitle}
                </h2>
                <div className="space-y-2">
                  {visible.map(entry => (
                    <VocabRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedId === entry.id}
                      isDeleting={deletingId === entry.id}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
                {remaining > 0 && (
                  <div className="mt-3 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => showMore(bookTitle)}
                    >
                      Show {Math.min(PER_BOOK_INCREMENT, remaining)} more ({remaining} hidden)
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
