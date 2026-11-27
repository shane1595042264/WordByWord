import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { BookWithProgress } from '@/hooks/use-books'

// KAN-424: the "Pick up where you left off" strip rendered a bare <img> for the
// book's cover, so a dead remote cover URL showed the broken-image glyph while
// the same book's shelf card fell back to a typographic cover.

let books: BookWithProgress[] = []
vi.mock('@/hooks/use-books', () => ({
  useBooks: () => ({ books, loading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('@/lib/services/sync-service', () => ({
  syncService: { getLastSyncedAt: () => null },
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'unauthenticated' }) }))
vi.mock('@/hooks/use-sync-status', () => ({ useSyncStatus: () => ({ isSyncing: false, progress: null }) }))
vi.mock('@/components/library/upload-dialog', () => ({ UploadDialog: () => null }))
vi.mock('@/components/auth/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/components/library/delete-confirm-dialog', () => ({ DeleteConfirmDialog: () => null }))
vi.mock('@/components/library/library-grid', () => ({ LibraryGrid: () => null }))

import HomePage from '../page'

function resumeBook(coverImage: string | undefined): BookWithProgress {
  return {
    id: 'b1',
    title: 'Zebra Notes',
    coverImage,
    processingStatus: 'complete',
    lastReadAt: 1000,
    progress: { percentage: 40 },
  } as unknown as BookWithProgress
}

const strip = () => screen.getByText('Pick up where you left off').closest('a')!

describe('Library resume strip cover fallback (KAN-424)', () => {
  beforeEach(() => { books = [] })

  it('swaps a cover that fails to load for the typographic cover', () => {
    books = [resumeBook('https://example.com/dead.jpg')]
    render(<HomePage />)
    const img = strip().querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://example.com/dead.jpg')

    fireEvent.error(img)

    expect(strip().querySelector('img')).toBeNull()
    expect(strip().querySelector('[aria-hidden="true"] span')?.textContent).toBe('Z')
  })

  it('retries when the book gets a new cover URL after a failure', () => {
    books = [resumeBook('https://example.com/dead.jpg')]
    const { rerender } = render(<HomePage />)
    fireEvent.error(strip().querySelector('img')!)
    expect(strip().querySelector('img')).toBeNull()

    books = [resumeBook('https://example.com/fresh.jpg')]
    rerender(<HomePage />)

    expect(strip().querySelector('img')?.getAttribute('src')).toBe('https://example.com/fresh.jpg')
  })

  it('control: a cover that loads stays an <img>', () => {
    books = [resumeBook('data:image/png;base64,iVBORw0KGgo=')]
    render(<HomePage />)
    expect(strip().querySelector('img')).not.toBeNull()
  })
})
