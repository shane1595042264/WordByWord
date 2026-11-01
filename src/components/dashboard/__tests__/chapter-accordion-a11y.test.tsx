import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import type { ChapterWithSections } from '@/hooks/use-book-detail'
import type { Section } from '@/lib/db/models'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import { ChapterAccordion } from '../chapter-accordion'

function section(id: string, chapterId: string, overrides: Partial<Section> = {}): Section {
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
    ...overrides,
  }
}

function chapter(id: string, title: string, sections: Section[]): ChapterWithSections {
  return {
    id,
    bookId: 'book-1',
    title,
    order: 0,
    startPage: 1,
    endPage: 1,
    updatedAt: 0,
    sections,
    progress: { read: 0, total: sections.length, percentage: 0 },
  }
}

const chapters = [
  chapter('alpha', 'Part 1 > Alpha', [section('a1', 'alpha')]),
  chapter('beta', 'Part 1 > Beta', [section('b1', 'beta')]),
  chapter('solo', 'Solo', [
    section('done', 'solo', { isRead: true, readAt: 1 }),
    section('half', 'solo', { scrollProgress: 40 }),
    section('fresh', 'solo'),
  ]),
]

describe('ChapterAccordion accessibility', () => {
  it('exposes expanded state on Part and chapter toggles', () => {
    render(<ChapterAccordion bookId="book-1" chapters={chapters} />)

    const part = screen.getByRole('button', { name: /^Part 1/ })
    expect(part.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(part)
    expect(part.getAttribute('aria-expanded')).toBe('true')

    const alpha = screen.getByRole('button', { name: /^Alpha/ })
    expect(alpha.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(alpha)
    expect(alpha.getAttribute('aria-expanded')).toBe('true')

    const solo = screen.getByRole('button', { name: /^Solo/ })
    expect(solo.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(solo)
    expect(solo.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the triangle glyph out of toggle names', () => {
    render(<ChapterAccordion bookId="book-1" chapters={chapters} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button.textContent).toContain('▶')
    expect(screen.getAllByRole('button', { name: name => !name.includes('▶') })).toEqual(buttons)
  })

  it('names each section link with its read state', () => {
    render(<ChapterAccordion bookId="book-1" chapters={chapters} />)
    fireEvent.click(screen.getByRole('button', { name: /^Solo/ }))

    expect(screen.getByRole('link', { name: /^Read:\s*done/ }).getAttribute('href')).toBe('/book/book-1/read/done')
    expect(screen.getByRole('link', { name: /^In progress:\s*half/ }).getAttribute('href')).toBe('/book/book-1/read/half')
    expect(screen.getByRole('link', { name: /^Unread:\s*fresh/ }).getAttribute('href')).toBe('/book/book-1/read/fresh')
  })
})
