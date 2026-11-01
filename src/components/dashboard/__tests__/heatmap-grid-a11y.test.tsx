import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Section } from '@/lib/db/models'
import { HeatmapGrid } from '../heatmap-grid'

function section(id: string, overrides: Partial<Section> = {}): Section {
  return {
    id,
    chapterId: 'ch-1',
    bookId: 'book-1',
    title: id,
    order: 0,
    startPage: 1,
    endPage: 5,
    extractedText: null,
    isRead: false,
    readAt: null,
    lastPageViewed: null,
    scrollProgress: null,
    updatedAt: 0,
    ...overrides,
  }
}

describe('HeatmapGrid reading states', () => {
  const sections = [
    section('done', { isRead: true, readAt: 1 }),
    section('done-with-progress', { isRead: true, readAt: 1, scrollProgress: 60 }),
    section('half', { scrollProgress: 40.4 }),
    section('zero', { scrollProgress: 0 }),
    section('fresh'),
  ]

  it('labels started-but-unread sections as in progress with the rounded percent', () => {
    render(<HeatmapGrid sections={sections} />)
    const half = screen.getByRole('button', { name: 'half — In progress (40%), pages 1-5' })
    expect(half.className).toContain('bg-yellow-500')
  })

  it('keeps Read for read sections regardless of scroll progress', () => {
    render(<HeatmapGrid sections={sections} />)
    for (const id of ['done', 'done-with-progress']) {
      const btn = screen.getByRole('button', { name: `${id} — Read, pages 1-5` })
      expect(btn.className).toContain('bg-green-500')
    }
  })

  it('keeps Unread for sections with zero or no scroll progress', () => {
    render(<HeatmapGrid sections={sections} />)
    for (const id of ['zero', 'fresh']) {
      const btn = screen.getByRole('button', { name: `${id} — Unread, pages 1-5` })
      expect(btn.className).toContain('bg-muted')
      expect(btn.className).not.toContain('bg-yellow-500')
    }
  })
})
