'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Section, Chapter } from '@/lib/db/models'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TocChapterGroup {
  chapter: Chapter
  sections: Section[]
}

interface TocViewerProps {
  bookId: string
  sectionTitle: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export function TocViewer({ bookId, sectionTitle }: TocViewerProps) {
  const [groups, setGroups] = useState<TocChapterGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { db } = await import('@/lib/db/database')
      const chapters = await db.chapters.where('bookId').equals(bookId).sortBy('order')
      const allSections = await db.sections.where('bookId').equals(bookId).sortBy('order')

      const chapterGroups: TocChapterGroup[] = []

      for (const ch of chapters) {
        // Skip the "Contents" chapter
        if (/^(table of )?contents$/i.test(ch.title)) continue

        const chSections = allSections.filter(s => s.chapterId === ch.id)
        if (chSections.length > 0) {
          chapterGroups.push({ chapter: ch, sections: chSections })
        }
      }

      setGroups(chapterGroups)
      setLoading(false)
    })()
  }, [bookId])

  if (loading) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  const totalSections = groups.reduce((sum, g) => sum + g.sections.length, 0)

  return (
    <div className="max-w-2xl mx-auto px-8 py-8">
        <h2 className="text-2xl font-bold mb-1 tracking-tight">{sectionTitle}</h2>
        <p className="text-sm text-muted-foreground mb-8">
          {groups.length} chapters &middot; {totalSections} sections
        </p>

        <nav className="space-y-0">
          {groups.map((group, gi) => {
            const isSingleSection = group.sections.length === 1
            const chapterTitle = cleanTitle(group.chapter.title)
            const firstSection = group.sections[0]

            // For chapters with one section, show a single flat entry
            if (isSingleSection) {
              return (
                <TocLink
                  key={gi}
                  bookId={bookId}
                  sectionId={firstSection.id}
                  title={chapterTitle}
                  page={firstSection.startPage}
                  bold
                  className={gi > 0 ? 'mt-4' : ''}
                />
              )
            }

            // For chapters with multiple sections, show chapter heading + children
            return (
              <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
                {/* Chapter heading — link to first section */}
                <TocLink
                  bookId={bookId}
                  sectionId={firstSection.id}
                  title={chapterTitle}
                  page={firstSection.startPage}
                  bold
                />

                {/* Child sections */}
                <div className="ml-1 border-l-2 border-muted/50">
                  {group.sections.map((sec, si) => {
                    // Skip the intro section that matches the chapter name
                    // (it's already represented by the chapter heading)
                    if (si === 0 && isIntroSection(sec.title)) return null

                    const isSubSection = /^(\d+\.)+\d*\s/.test(sec.title) || /^[A-Z]\.\d+\s/.test(sec.title)

                    return (
                      <TocLink
                        key={si}
                        bookId={bookId}
                        sectionId={sec.id}
                        title={cleanSectionTitle(sec.title)}
                        page={sec.startPage}
                        indent={isSubSection ? 1 : 1}
                        small
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </nav>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TocLink({
  bookId, sectionId, title, page, bold, small, indent = 0, className = '',
}: {
  bookId: string
  sectionId: string
  title: string
  page: number
  bold?: boolean
  small?: boolean
  indent?: number
  className?: string
}) {
  const paddingLeft = indent === 0 ? 'pl-3' : indent === 1 ? 'pl-6' : 'pl-10'

  return (
    <Link
      href={`/book/${bookId}/read/${sectionId}`}
      className={`block no-underline ${className}`}
    >
      <div className={`
        group flex items-baseline gap-2 pr-3 rounded-md
        hover:bg-muted/50 transition-colors
        ${paddingLeft}
        ${bold ? 'py-2' : 'py-1.5'}
      `}>
        <span className={`
          transition-colors group-hover:text-primary
          ${bold ? 'font-semibold text-base text-foreground' : ''}
          ${small ? 'text-sm text-foreground/80' : ''}
          ${!bold && !small ? 'text-sm text-foreground' : ''}
        `}>
          {title}
        </span>
        <span className="flex-1 border-b border-dotted border-muted-foreground/20 min-w-[1rem] translate-y-[-3px]" />
        <span className={`
          text-xs tabular-nums shrink-0 transition-colors group-hover:text-primary
          ${bold ? 'text-muted-foreground' : 'text-muted-foreground/50'}
        `}>
          {page}
        </span>
      </div>
    </Link>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function cleanTitle(title: string): string {
  // Remove "Parent > " path prefix (e.g. "Design Pattern Catalog > 3 Creational Patterns")
  let cleaned = title.includes(' > ') ? title.split(' > ').pop()! : title
  // Remove "— Introduction" suffix from chapter titles that have it
  return cleaned.replace(/\s*—\s*Introduction$/i, '').trim()
}

function cleanSectionTitle(title: string): string {
  // Remove "Chapter N — " prefix pattern if present
  return title.replace(/^\d+\s+\w+\s*—\s*/, '').trim() || title
}

function isIntroSection(title: string): boolean {
  return /—\s*Introduction$/i.test(title)
}