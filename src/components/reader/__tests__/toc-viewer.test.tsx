import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Chapter, Section } from '@/lib/db/models'

// next/link renders an <a> in the app; jsdom only needs the href so the control
// arm can assert the real TOC destinations.
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}))

// The loader body is `await import('@/lib/db/database')`, so the module is mocked
// wholesale. `failRead` reproduces the rejection the component used to swallow:
// a stale _next chunk after a deploy, IndexedDB blocked in private mode, a quota
// or Dexie schema-upgrade error (KAN-312).
const state = vi.hoisted(() => ({
  failRead: null as Error | null,
  chapters: [] as unknown[],
  sections: [] as unknown[],
}))

vi.mock('@/lib/db/database', () => {
  const table = (rows: () => unknown[]) => ({
    where: () => ({
      equals: () => ({
        sortBy: async () => {
          if (state.failRead) throw state.failRead
          return rows()
        },
      }),
    }),
  })
  return { db: { chapters: table(() => state.chapters), sections: table(() => state.sections) } }
})

import { TocViewer } from '../toc-viewer'

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: 'ch-1', bookId: 'book-1', title: 'Chapter One',
    order: 0, startPage: 1, endPage: 10, updatedAt: 0, ...overrides,
  }
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: 'sec-1', chapterId: 'ch-1', bookId: 'book-1', title: 'Chapter One',
    order: 0, startPage: 1, endPage: 5, extractedText: null, isRead: false,
    readAt: null, lastPageViewed: null, scrollProgress: null, updatedAt: 0, ...overrides,
  }
}

const renderToc = () =>
  render(<TocViewer bookId="book-1" extractedText="" sectionTitle="Contents" />)

describe('TocViewer load failures', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.failRead = null
    state.chapters = []
    state.sections = []
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
  })

  // Failure arm: the loader used to leave loading=true forever, so the pane sat
  // on "Loading..." with no console trace and no way forward.
  it('renders an error state instead of hanging on Loading... when the read rejects', async () => {
    state.failRead = new Error('Loading chunk 8421 failed')

    renderToc()

    await waitFor(() => {
      expect(screen.getByText(/Could not load the contents/i)).toBeDefined()
    })
    expect(screen.queryByText('Loading...')).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      '[lazy-import] TOC viewer load failed:',
      expect.any(Error)
    )
  })

  it('recovers via Retry once the read succeeds again', async () => {
    state.failRead = new Error('IDB blocked')

    renderToc()
    await waitFor(() => expect(screen.getByText(/Could not load the contents/i)).toBeDefined())

    state.failRead = null
    state.chapters = [chapter()]
    state.sections = [section()]
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(screen.getByText('Chapter One')).toBeDefined()
    })
    expect(screen.queryByText(/Could not load the contents/i)).toBeNull()
  })

  // Control arm: the happy path must render exactly as before the fix.
  it('renders the real TOC when the read succeeds', async () => {
    state.chapters = [chapter()]
    state.sections = [section()]

    renderToc()

    await waitFor(() => expect(screen.getByText('Chapter One')).toBeDefined())
    const link = screen.getByRole('link', { name: /Chapter One/ })
    expect(link.getAttribute('href')).toBe('/book/book-1/read/sec-1')
    expect(screen.getByText(/1 chapters/)).toBeDefined()
  })

  // Empty arm: every chapter filtered out (here by the "Contents" skip) used to
  // render "0 chapters / 0 sections" above a completely blank nav.
  it('explains the empty case instead of rendering a blank nav', async () => {
    state.chapters = [chapter({ title: 'Table of Contents' })]
    state.sections = [section()]

    renderToc()

    await waitFor(() => {
      expect(screen.getByText(/No chapters to list yet/i)).toBeDefined()
    })
    expect(screen.queryByText(/0 chapters/)).toBeNull()
  })
})
