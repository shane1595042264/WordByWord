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
const useProcessingStatus = vi.fn((_jobId: string | undefined): { data: unknown; pollError: null; retry: () => void } => ({ data: null, pollError: null, retry: vi.fn() }))
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

describe('BookCard leaves the processing state when the job fails (KAN-359)', () => {
  const failed = { status: 'failed', progress: 45, stage: 'ocr', error: 'boom', bookId: 'remote-1' }

  beforeEach(async () => {
    await db.books.clear()
    await db.books.add(makeBook({ processingStatus: 'processing', jobId: 'job-a' }))
    useProcessingStatus.mockReset()
    useProcessingStatus.mockImplementation(() => ({ data: failed, pollError: null, retry: vi.fn() }))
  })

  it('flips the local row to error once, without an updatedAt bump, and refreshes', async () => {
    const onProcessingComplete = vi.fn()
    const book = withProgress((await db.books.get('book-1'))!)
    const { rerender } = render(<BookCard book={book} onProcessingComplete={onProcessingComplete} />)

    await waitFor(() => expect(onProcessingComplete).toHaveBeenCalledTimes(1))
    const row = await db.books.get('book-1')
    expect(row?.processingStatus).toBe('error')
    expect(row?.updatedAt).toBe(1234)

    // A re-render with the same stale processing row must not fire again.
    rerender(<BookCard book={book} onProcessingComplete={onProcessingComplete} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(onProcessingComplete).toHaveBeenCalledTimes(1)

    // The refreshed row renders the failed state: Retry, no Cancel, a link.
    rerender(<BookCard book={withProgress(row!)} onProcessingComplete={onProcessingComplete} />)
    expect(screen.getByText('Processing failed')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(screen.queryByText('45%')).toBeNull()
    expect(document.querySelector('a[href="/book/book-1"]')).not.toBeNull()
  })

  it('re-arms for a new job after Retry', async () => {
    const onProcessingComplete = vi.fn()
    const { rerender } = render(
      <BookCard book={withProgress((await db.books.get('book-1'))!)} onProcessingComplete={onProcessingComplete} />,
    )
    await waitFor(() => expect(onProcessingComplete).toHaveBeenCalledTimes(1))

    await db.books.update('book-1', { processingStatus: 'processing', jobId: 'job-b' })
    rerender(<BookCard book={withProgress((await db.books.get('book-1'))!)} onProcessingComplete={onProcessingComplete} />)
    await waitFor(() => expect(onProcessingComplete).toHaveBeenCalledTimes(2))
    expect((await db.books.get('book-1'))?.processingStatus).toBe('error')
  })

  it('does nothing while the job is still running', async () => {
    useProcessingStatus.mockImplementation(() => ({ data: { ...failed, status: 'processing' }, pollError: null, retry: vi.fn() }))
    const onProcessingComplete = vi.fn()
    render(<BookCard book={withProgress((await db.books.get('book-1'))!)} onProcessingComplete={onProcessingComplete} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(onProcessingComplete).not.toHaveBeenCalled()
    expect((await db.books.get('book-1'))?.processingStatus).toBe('processing')
    expect(screen.getByText('45%')).toBeTruthy()
  })
})
