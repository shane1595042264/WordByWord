/**
 * Page navigation for the section-scoped PDF reader.
 *
 * Each Section carries an inclusive `startPage..endPage` range of absolute PDF
 * pages, and adjacent sections frequently OVERLAP on a page: "7 Heaps" may be
 * 37..37 while "7.1 Merge sorted files" is 37..38 because 7.1 starts mid-page.
 * The old toolbar behaviour ("next page in this section, else jump to the next
 * section at its start page") therefore re-showed page 37 when stepping from the
 * chapter intro into 7.1. This module resolves Next/Prev as "show me the
 * next/previous PDF page", skipping sections that live entirely on pages already
 * shown and bridging gaps in page coverage by landing on the nearest edge of the
 * next section that has any pages in that direction.
 *
 * A forward hop reports the sections it skipped in `skippedSectionIds`: they
 * hold only pages the reader just paged through, but are never opened, so the
 * caller must mark them read or a book read cover to cover never reaches 100%.
 */

export interface PageRangeSection {
  id: string
  startPage: number
  endPage: number
}

export type PageNavTarget =
  | { kind: 'page'; page: number }
  | { kind: 'section'; sectionId: string; page: number; skippedSectionIds?: string[] }
  | null

/** Clamp `page` into the inclusive range of `section`. */
export function clampPage(page: number, section: PageRangeSection): number {
  return Math.min(Math.max(page, section.startPage), section.endPage)
}

/**
 * Resolve what "next/previous PDF page" means from a section-scoped reader.
 * `sections` must be in book reading order. `direction` is 1 (next) or -1 (prev).
 */
export function resolvePdfPageNav(
  sections: readonly PageRangeSection[],
  currentSectionId: string,
  currentPage: number,
  direction: 1 | -1,
): PageNavTarget {
  const curIndex = sections.findIndex((s) => s.id === currentSectionId)
  if (curIndex === -1) return null
  const cur = sections[curIndex]

  const target = clampPage(currentPage, cur) + direction

  if (cur.startPage <= target && target <= cur.endPage) {
    return { kind: 'page', page: target }
  }

  if (direction === 1) {
    const skipped: string[] = []
    for (let i = curIndex + 1; i < sections.length; i++) {
      const s = sections[i]
      if (s.endPage < target) { // entirely on pages already shown
        skipped.push(s.id)
        continue
      }
      const page = s.startPage <= target ? target : s.startPage // contains target, or gap
      return withSkipped({ kind: 'section', sectionId: s.id, page: clampPage(page, s) }, skipped)
    }
    // Every later section sits on pages already shown (back matter sharing the
    // last page). Land on the last one, re-showing its final page, rather than
    // leave them all unreachable.
    const last = skipped.pop()
    if (last === undefined) return null
    return withSkipped({ kind: 'section', sectionId: last, page: sections[sections.length - 1].endPage }, skipped)
  }

  for (let i = curIndex - 1; i >= 0; i--) {
    const s = sections[i]
    if (s.startPage > target) continue // entirely on pages already shown
    const page = s.endPage >= target ? target : s.endPage // contains target, or gap
    return { kind: 'section', sectionId: s.id, page: clampPage(page, s) }
  }
  return null
}

function withSkipped(
  target: { kind: 'section'; sectionId: string; page: number },
  skipped: string[],
): PageNavTarget {
  return skipped.length > 0 ? { ...target, skippedSectionIds: skipped } : target
}
