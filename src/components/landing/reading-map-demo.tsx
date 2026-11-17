'use client'

import { useMemo } from 'react'
import { HeatmapGrid } from '@/components/dashboard/heatmap-grid'
import type { Section } from '@/lib/db/models'

/**
 * The book page's real reading map, fed an example book: twelve chapters,
 * read front to back for six of them, one chapter half done, and two
 * sections read out of order further on, the way people actually read
 * reference books. Deterministic so server and client agree.
 */
const CHAPTER_LENGTHS = [7, 9, 8, 10, 9, 11, 10, 9, 12, 8, 10, 9]

function buildExampleSections(): Section[] {
  const sections: Section[] = []
  let page = 1
  CHAPTER_LENGTHS.forEach((count, c) => {
    for (let s = 0; s < count; s++) {
      const pages = 4 + ((c * 7 + s * 3) % 6)
      let isRead = false
      let scrollProgress: number | null = null
      if (c < 6) isRead = !(c === 4 && s === 6)
      else if (c === 6) {
        if (s < 5) isRead = true
        else if (s === 5) scrollProgress = 62
      } else if (c === 9 && (s === 2 || s === 3)) isRead = true
      else if (c === 11 && s === 0) scrollProgress = 18
      sections.push({
        id: `example-${c + 1}-${s + 1}`,
        chapterId: `example-ch-${c + 1}`,
        bookId: 'example',
        title: `Chapter ${c + 1}, part ${s + 1}`,
        order: s,
        startPage: page,
        endPage: page + pages - 1,
        extractedText: null,
        isRead,
        readAt: isRead ? 1 : null,
        lastPageViewed: null,
        scrollProgress,
        updatedAt: 0,
      })
      page += pages
    }
  })
  return sections
}

const EXAMPLE_SECTIONS = buildExampleSections()

export const EXAMPLE_COUNTS = {
  read: EXAMPLE_SECTIONS.filter(s => s.isRead).length,
  started: EXAMPLE_SECTIONS.filter(s => !s.isRead && (s.scrollProgress ?? 0) > 0).length,
  total: EXAMPLE_SECTIONS.length,
}

/** The map itself, sized to read as a block (about 20 squares a row). */
export function ReadingMapDemo() {
  const sections = useMemo(() => EXAMPLE_SECTIONS, [])
  return (
    <div className="rounded-xl border bg-card p-6 shadow-[0_30px_60px_-34px_oklch(0.22_0.04_170/0.35)] sm:p-9">
      <div className="mx-auto max-w-[416px]">
        <HeatmapGrid sections={sections} />
      </div>
    </div>
  )
}

/** The three totals beside the map, computed from the same example book. */
export function ReadingMapStats() {
  const { read, started, total } = EXAMPLE_COUNTS
  return (
    <dl className="grid grid-cols-3 gap-6">
      <div>
        <dt className="text-sm text-muted-foreground">Read</dt>
        <dd className="font-display text-3xl font-semibold tabular-nums tracking-tight">{read}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">In progress</dt>
        <dd className="font-display text-3xl font-semibold tabular-nums tracking-tight">{started}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">Still to read</dt>
        <dd className="font-display text-3xl font-semibold tabular-nums tracking-tight">{total - read - started}</dd>
      </div>
    </dl>
  )
}
