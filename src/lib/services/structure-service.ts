export interface ChapterStructure {
  title: string
  startPage: number
  endPage: number
  sections?: Array<{
    title: string
    startPage: number
    endPage: number
  }>
}

/**
 * Thrown when PUT /books/:id/structure returns 409 STALE_BOOK — another writer
 * (typically a second tab) touched the book after this client loaded it.
 */
export class StaleBookError extends Error {
  readonly name = 'StaleBookError'
  constructor(public currentUpdatedAt?: string) {
    super('Another tab edited this book since you opened it. Reload to see latest structure.')
  }
}

export class StructureService {
  private async getToken(): Promise<string | null> {
    const res = await fetch('/api/auth/token')
    if (!res.ok) return null
    const { token } = await res.json()
    return token
  }

  private getApiUrl() {
    return process.env.NEXT_PUBLIC_API_URL || ''
  }

  /**
   * @param expectedUpdatedAt ISO timestamp of books.updatedAt at the time the client loaded
   *   the book. When supplied, the server rejects with 409 STALE_BOOK on mismatch (throws
   *   StaleBookError here). When omitted, the server falls through to best-effort overwrite.
   */
  async saveStructure(
    bookRemoteId: string,
    chapters: ChapterStructure[],
    expectedUpdatedAt?: string,
  ) {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${this.getApiUrl()}/books/${bookRemoteId}/structure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        expectedUpdatedAt ? { chapters, expectedUpdatedAt } : { chapters },
      ),
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => null) as { error?: string; currentUpdatedAt?: string } | null
      if (body?.error === 'STALE_BOOK') throw new StaleBookError(body.currentUpdatedAt)
    }
    if (!res.ok) throw new Error(`Save failed: ${res.status}`)
    return res.json()
  }

  async suggestFromTOC(bookRemoteId: string, tocPages: number[]) {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${this.getApiUrl()}/books/${bookRemoteId}/suggest-structure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tocPages }),
    })
    if (!res.ok) throw new Error(`AI suggest failed: ${res.status}`)
    return res.json()
  }
}
