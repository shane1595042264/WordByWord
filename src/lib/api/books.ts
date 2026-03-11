import { apiClient, apiUpload } from './client'

export async function matchBook(fileHash: string, title?: string) {
  return apiClient<{ exactMatch: any | null; fuzzyMatches: any[] }>('/books/match', {
    method: 'POST',
    body: JSON.stringify({ fileHash, title }),
  })
}

export async function uploadBook(file: File, title: string, author?: string, totalPages?: number) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('title', title)
  if (author) formData.append('author', author)
  if (totalPages) formData.append('totalPages', totalPages.toString())

  return apiUpload<{ book: any; catalogEntry: any; isNew: boolean }>('/books/upload', formData)
}

export async function startProcessing(bookId: string) {
  return apiClient<{ jobId: string; clientSecret: string; amountCents: number }>('/processing/start', {
    method: 'POST',
    body: JSON.stringify({ bookId }),
  })
}

export async function getProcessingStatus(jobId: string) {
  return apiClient<{ status: string; progress: number; error?: string; nibUrl?: string }>(`/processing/${jobId}`)
}
