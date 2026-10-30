import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { ChapterWithSections } from '@/hooks/use-book-detail'
import type { Section } from '@/lib/db/models'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import { ChapterAccordion } from '../chapter-accordion'

function section(id: string, chapterId: string): Section {
  return {
    id,
    chapterId,
    bookId: 'book-1',
    title: id,
    order: 0,
    startPage: 1,
    endPage: 1,
    extractedText: null,
    isRead: false,
    readAt: null,
    lastPageViewed: null,
    scrollProgress: null,
    updatedAt: 0,
  }
}

function chapter(id: string, title: string, sectionIds: string[]): ChapterWithSections {
  return {
    id,
    bookId: 'book-1',
    title,
    order: 0,
    startPage: 1,
    endPage: 1,
    updatedAt: 0,
    sections: sectionIds.map(s => section(s, id)),
    progress: { read: 0, total: sectionIds.length, percentage: 0 },
  }
}

const chapters = [
  chapter('alpha', 'Part 1 > Alpha', ['a1', 'a2']),
  chapter('beta', 'Part 1 > Beta', ['b1']),
  chapter('gamma', 'Part 2 > Gamma', ['g1']),
]

function search(query: string) {
  const { container } = render(<ChapterAccordion bookId="book-1" chapters={chapters} searchQuery={query} />)
  const links = [...container.querySelectorAll('a[href*="/read/"]')].map(a => a.getAttribute('href')!.split('/').pop())
  const empty = [...container.querySelectorAll('p')].filter(p => p.textContent === 'No sections yet.').length
  return { links, empty, text: container.textContent ?? '' }
}

describe('ChapterAccordion search', () => {
  it('shows every section of a Part whose title is the only match', () => {
    const { links, empty, text } = search('part 1')
    expect(links).toEqual(['a1', 'a2', 'b1'])
    expect(empty).toBe(0)
    expect(text).toContain('Alpha')
    expect(text).toContain('Beta')
    expect(text).not.toContain('Gamma')
  })

  it('still shows only the matching chapter on a chapter title match', () => {
    const { links, text } = search('alpha')
    expect(links).toEqual(['a1', 'a2'])
    expect(text).not.toContain('Beta')
  })

  it('still shows only the matching section on a section title match', () => {
    const { links, text } = search('a1')
    expect(links).toEqual(['a1'])
    expect(text).not.toContain('Beta')
  })
})
