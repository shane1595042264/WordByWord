'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { VocabEntry } from '@/lib/db/models'

export default function VocabularyPage() {
  const [entries, setEntries] = useState<VocabEntry[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    const { VocabService } = await import('@/lib/services/vocab-service')
    const svc = new VocabService()
    const all = await svc.getAll()
    setEntries(all)
    setLoading(false)
  }, [])

  useEffect(() => { loadEntries() }, [loadEntries])

  const handleDelete = useCallback(async (id: string) => {
    const { VocabService } = await import('@/lib/services/vocab-service')
    const svc = new VocabService()
    await svc.delete(id)
    setEntries(prev => prev.filter(e => e.id !== id))
  }, [])

  const filtered = search
    ? entries.filter(e =>
        e.word.toLowerCase().includes(search.toLowerCase()) ||
        e.translation.toLowerCase().includes(search.toLowerCase()) ||
        e.bookTitle.toLowerCase().includes(search.toLowerCase())
      )
    : entries

  // Group by book
  const grouped = new Map<string, VocabEntry[]>()
  for (const entry of filtered) {
    const key = entry.bookTitle || 'Unknown'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(entry)
  }

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

      {entries.length === 0 ? (
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

          {[...grouped.entries()].map(([bookTitle, bookEntries]) => (
            <div key={bookTitle} className="mb-8">
              <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
                {bookTitle}
              </h2>
              <div className="space-y-2">
                {bookEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="border border-border/50 rounded-lg overflow-hidden bg-card hover:bg-accent/5 transition-colors"
                  >
                    {/* Main row */}
                    <div
                      className="flex items-center gap-4 px-4 py-3 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
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
                        className={`w-4 h-4 text-muted-foreground/40 transition-transform ${expandedId === entry.id ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>

                    {/* Expanded detail */}
                    {expandedId === entry.id && (
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
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(entry.id)
                            }}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
