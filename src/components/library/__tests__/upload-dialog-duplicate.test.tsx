import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { db } from '@/lib/db/database'
import type { Book } from '@/lib/db/models'

const uploadBook = vi.fn()
vi.mock('@/lib/services/sync-service', () => ({
  syncService: { uploadBook: (...args: unknown[]) => uploadBook(...args) },
}))

const toastInfo = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { info: (...a: unknown[]) => toastInfo(...a), error: (...a: unknown[]) => toastError(...a) },
}))

import { UploadDialog } from '../upload-dialog'

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'local-original',
    title: 'My Renamed Book',
    author: 'Author',
    totalPages: 0,
    format: 'epub',
    coverImage: null,
    structureSource: 'epub',
    processingStatus: 'complete',
    createdAt: 1000,
    updatedAt: 2000,
    lastReadAt: 1500,
    lastAccessedSectionId: 'section-7',
    lastAccessedScrollProgress: 42,
    lastAccessedWordIndex: null,
    completedAt: null,
    remoteId: 'remote-1',
    catalogId: 'catalog-1',
    ...overrides,
  }
}

/** Opens the dialog and picks an EPUB (EPUBs upload straight away, no pdf.js). */
async function uploadEpub(onBookImported = vi.fn()) {
  render(<UploadDialog onBookImported={onBookImported} />)
  fireEvent.click(screen.getByRole('button', { name: 'Upload Book' }))
  const input = await screen.findByLabelText('Select PDF or EPUB file')
  const file = new File(['epub-bytes'], 'book.epub', { type: 'application/epub+zip' })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(onBookImported).toHaveBeenCalledTimes(1))
}

describe('UploadDialog re-upload of a book already in the library (KAN-345)', () => {
  beforeEach(async () => {
    await db.books.clear()
    uploadBook.mockReset()
    toastInfo.mockReset()
    toastError.mockReset()
  })

  it('does not add a second local row for a remoteId that is already present', async () => {
    await db.books.add(makeBook())
    uploadBook.mockResolvedValue({ remoteId: 'remote-1', catalogId: 'catalog-1', jobId: undefined })

    await uploadEpub()

    const books = await db.books.toArray()
    expect(books).toHaveLength(1)
    // The original row is untouched — still dirty-free and still holding its position.
    expect(books[0]).toMatchObject({
      id: 'local-original',
      title: 'My Renamed Book',
      updatedAt: 2000,
      lastAccessedSectionId: 'section-7',
      lastAccessedScrollProgress: 42,
    })
    expect(toastInfo).toHaveBeenCalledWith('"My Renamed Book" is already in your library')
    expect(toastError).not.toHaveBeenCalled()
  })

  it('points the existing row at a processing job the backend restarted, without dirtying it', async () => {
    await db.books.add(makeBook({ processingStatus: 'error', jobId: 'old-job' }))
    uploadBook.mockResolvedValue({ remoteId: 'remote-1', catalogId: 'catalog-1', jobId: 'new-job' })

    await uploadEpub()

    const books = await db.books.toArray()
    expect(books).toHaveLength(1)
    expect(books[0]).toMatchObject({
      id: 'local-original',
      processingStatus: 'processing',
      jobId: 'new-job',
      updatedAt: 2000,
    })
  })

  it('still adds a row for a book the user does not have yet (control)', async () => {
    await db.books.add(makeBook())
    uploadBook.mockResolvedValue({ remoteId: 'remote-2', catalogId: 'catalog-2', jobId: 'job-2' })

    await uploadEpub()

    const books = await db.books.toArray()
    expect(books).toHaveLength(2)
    const added = books.find((b) => b.remoteId === 'remote-2')
    expect(added).toMatchObject({ title: 'book', processingStatus: 'processing', jobId: 'job-2' })
    expect(toastInfo).not.toHaveBeenCalled()
  })
})
