import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'
import type { BookWithProgress } from '@/hooks/use-books'

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// Records which job id the card asks the hook to poll.
const useProcessingStatus = vi.fn((_jobId: string | undefined) => ({ data: null, pollError: null, retry: vi.fn() }))
vi.mock('@/hooks/use-processing-status', () => ({
  useProcessingStatus: (jobId: string | undefined) => useProcessingStatus(jobId),
}))

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }))

import { BookCard } from '../book-card'

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    title: 'Failed Book',
    author: 'Author',
    totalPages: 10,
    coverImage: null,
    structureSource: 'native',
    processingStatus: 'error',
    createdAt: 0,
    updatedAt: 1234,
    lastReadAt: null,
    lastAccessedSectionId: null,
    lastAccessedScrollProgress: null,
    lastAccessedWordIndex: null,
    completedAt: null,
    remoteId: 'remote-1',
    jobId: 'old-job',
    ...overrides,
  }
}

const withProgress = (book: Book): BookWithProgress => ({ ...book, progress: { read: 0, total: 0, percentage: 0 } })

describe('BookCard Retry adopts the new job id (KAN-347)', () => {
  const fetchMock = vi.fn()

  beforeEach(async () => {
    await db.books.clear()
    await db.books.add(makeBook())
    useProcessingStatus.mockClear()
    toastError.mockReset()
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/token') return new Response(JSON.stringify({ token: 't' }))
      if (url.endsWith('/processing/old-job/retry')) return new Response(JSON.stringify({ jobId: 'new-job' }))
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('writes the jobId /retry returns, so polling and Cancel target the new job', async () => {
    const onProcessingComplete = vi.fn()
    const { rerender } = render(
      <BookCard book={withProgress(makeBook())} onProcessingComplete={onProcessingComplete} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(onProcessingComplete).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/processing\/old-job\/retry$/), expect.anything())
    const row = await db.books.get('book-1')
    expect(row?.jobId).toBe('new-job')
    expect(row?.processingStatus).toBe('processing')
    // Backend-managed fields only — no sync push of the row.
    expect(row?.updatedAt).toBe(1234)
    expect(toastError).not.toHaveBeenCalled()

    // The live query hands the card the updated row; it must poll the new job.
    rerender(<BookCard book={withProgress(row!)} onProcessingComplete={onProcessingComplete} />)
    expect(useProcessingStatus).toHaveBeenLastCalledWith('new-job')
  })

  it('leaves the row alone when /retry fails', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/auth/token') return new Response(JSON.stringify({ token: 't' }))
      return new Response(JSON.stringify({ error: 'Job already retried' }), { status: 409 })
    })
    render(<BookCard book={withProgress(makeBook())} />)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Job already retried', expect.anything()))

    const row = await db.books.get('book-1')
    expect(row?.jobId).toBe('old-job')
    expect(row?.processingStatus).toBe('error')
  })
})
