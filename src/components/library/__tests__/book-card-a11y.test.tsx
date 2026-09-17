import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { BookWithProgress } from '@/hooks/use-books'

// next/link renders an <a> in the app; jsdom only needs the href to be there so
// the editMode=false regression assertion can read it.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// The card mounts useProcessingStatus unconditionally. Its real implementation
// fetches a token at module scope of the effect; none of these cases are
// processing, so a quiet stub keeps the test off the network.
vi.mock('@/hooks/use-processing-status', () => ({
  useProcessingStatus: () => ({ data: null, pollError: null, retry: vi.fn() }),
}))

import { BookCard } from '../book-card'

function makeBook(overrides: Partial<BookWithProgress> = {}): BookWithProgress {
  return {
    id: 'book-1',
    title: 'Structure and Interpretation',
    author: 'Abelson',
    totalPages: 100,
    coverImage: null,
    structureSource: 'native',
    processingStatus: 'complete',
    createdAt: 0,
    lastReadAt: null,
    lastAccessedSectionId: null,
    lastAccessedScrollProgress: null,
    lastAccessedWordIndex: null,
    completedAt: null,
    updatedAt: 0,
    progress: { read: 3, total: 10, percentage: 30 },
    ...overrides,
  }
}

/** The per-card selection control introduced by KAN-310. */
const checkbox = () => screen.getByRole('checkbox', { name: 'Select Structure and Interpretation' })

type ToggleSelect = (id: string, event?: React.MouseEvent | React.KeyboardEvent) => void

describe('BookCard keyboard + screen-reader access in Manage mode (KAN-310)', () => {
  let onToggleSelect: Mock<ToggleSelect>

  beforeEach(() => {
    onToggleSelect = vi.fn()
  })

  it('exposes a focusable, named checkbox that announces its checked state', () => {
    const { unmount } = render(
      <BookCard book={makeBook()} editMode selected={false} onToggleSelect={onToggleSelect} />,
    )

    const box = checkbox()
    expect(box.getAttribute('aria-checked')).toBe('false')
    expect(box.getAttribute('tabindex')).toBe('0')

    // Focus actually lands on it — the whole point of the ticket.
    box.focus()
    expect(document.activeElement).toBe(box)

    unmount()
    render(<BookCard book={makeBook()} editMode selected onToggleSelect={onToggleSelect} />)
    expect(checkbox().getAttribute('aria-checked')).toBe('true')
  })

  it('fires onToggleSelect exactly once for Enter and once for Space', () => {
    render(<BookCard book={makeBook()} editMode onToggleSelect={onToggleSelect} />)
    const box = checkbox()

    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onToggleSelect).toHaveBeenCalledTimes(1)
    expect(onToggleSelect.mock.calls[0][0]).toBe('book-1')

    fireEvent.keyDown(box, { key: ' ' })
    expect(onToggleSelect).toHaveBeenCalledTimes(2)
    expect(onToggleSelect.mock.calls[1][0]).toBe('book-1')
  })

  it('preventDefaults Space so the grid does not scroll out from under the user', () => {
    render(<BookCard book={makeBook()} editMode onToggleSelect={onToggleSelect} />)
    const evt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    fireEvent(checkbox(), evt)
    expect(evt.defaultPrevented).toBe(true)
  })

  it('ignores keys that are not Enter or Space', () => {
    render(<BookCard book={makeBook()} editMode onToggleSelect={onToggleSelect} />)
    fireEvent.keyDown(checkbox(), { key: 'a' })
    fireEvent.keyDown(checkbox(), { key: 'Tab' })
    expect(onToggleSelect).not.toHaveBeenCalled()
  })

  it('passes shiftKey through so Shift+Enter range-selects like Shift-click', () => {
    render(<BookCard book={makeBook()} editMode onToggleSelect={onToggleSelect} />)

    fireEvent.keyDown(checkbox(), { key: 'Enter', shiftKey: true })
    expect(onToggleSelect.mock.calls[0][1]!.shiftKey).toBe(true)

    fireEvent.keyDown(checkbox(), { key: 'Enter', ctrlKey: true })
    expect(onToggleSelect.mock.calls[1][1]!.ctrlKey).toBe(true)
  })

  it('does not double-toggle: a click on the checkbox never reaches the card onClick', () => {
    render(<BookCard book={makeBook()} editMode onToggleSelect={onToggleSelect} />)
    fireEvent.click(checkbox())
    // The card wrapper also calls onToggleSelect; if the event bubbled, the two
    // calls would cancel each other out in page.tsx's toggle.
    expect(onToggleSelect).toHaveBeenCalledTimes(1)
  })

  it('keeps View Log in the DOM without any pointer event, so it can be tabbed to', () => {
    render(
      <BookCard book={makeBook({ jobId: 'job-1' })} editMode onToggleSelect={onToggleSelect} />,
    )
    // Previously mount-gated on hover state, so a keyboard user never saw it.
    const viewLog = screen.getByRole('button', { name: /View Log/ })
    expect((viewLog as HTMLButtonElement).disabled).toBe(false)
  })

  it('leaves the non-edit-mode card as a plain link with no checkbox role', () => {
    render(<BookCard book={makeBook()} onToggleSelect={onToggleSelect} />)
    expect(screen.queryByRole('checkbox')).toBe(null)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/book/book-1')
    // View Log is an edit-mode affordance only.
    expect(screen.queryByRole('button', { name: /View Log/ })).toBe(null)
  })
})
