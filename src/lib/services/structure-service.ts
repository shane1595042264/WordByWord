import { db } from '@/lib/db/database'

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
    super('Another device edited this book while you were editing. Reload to see the latest structure, then re-apply your changes.')
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
   * The optimistic-lock token must be a timestamp the SERVER issued. The local Book row's
   * `updatedAt` is a browser-clock value the server never sees (sync strips it), so passing
   * it in guaranteed a 409 for the legitimate single-tab writer — KAN-304. We read
   * `serverUpdatedAt` instead, which sync populates straight from books.updatedAt.
   *
   * Undefined (client hasn't synced since the KAN-304 deploy) means no token is sent and the
   * server falls through to its existing best-effort overwrite path.
   */
  private async getLockToken(bookRemoteId: string): Promise<string | undefined> {
    const local = await db.books.where('remoteId').equals(bookRemoteId).first()
    return local?.serverUpdatedAt ? new Date(local.serverUpdatedAt).toISOString() : undefined
  }

  /** Store the timestamp the save returned so an immediate second save isn't rejected. */
  private async storeLockToken(bookRemoteId: string, updatedAt: unknown) {
    if (typeof updatedAt !== 'string') return
    const ms = new Date(updatedAt).getTime()
    if (!Number.isFinite(ms)) return
    const local = await db.books.where('remoteId').equals(bookRemoteId).first()
    if (local) await db.books.update(local.id, { serverUpdatedAt: ms })
  }

  private async putStructure(
    bookRemoteId: string,
    chapters: ChapterStructure[],
    expectedUpdatedAt: string | undefined,
    token: string,
  ) {
    const res = await fetch(`${this.getApiUrl()}/books/${bookRemoteId}/structure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(
        expectedUpdatedAt ? { chapters, expectedUpdatedAt } : { chapters },
      ),
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => null) as { error?: string; currentUpdatedAt?: string } | null
      if (body?.error === 'STALE_BOOK') return { stale: true as const, currentUpdatedAt: body.currentUpdatedAt }
    }
    if (!res.ok) throw new Error(`Save failed: ${res.status}`)
    return { stale: false as const, data: await res.json() }
  }

  async saveStructure(bookRemoteId: string, chapters: ChapterStructure[]) {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated')

    const first = await this.putStructure(
      bookRemoteId, chapters, await this.getLockToken(bookRemoteId), token,
    )
    if (!first.stale) {
      await this.storeLockToken(bookRemoteId, first.data?.updatedAt)
      return first.data
    }

    // Stale token. Something bumped books.updatedAt since our last sync — another device,
    // or one of this app's own non-sync writes. Pull once to converge serverUpdatedAt and
    // retry exactly once, so the user doesn't lose the divider layout they just built.
    const { syncService } = await import('@/lib/services/sync-service')
    await syncService.sync().catch(() => { /* fall through to the retry with what we have */ })

    const retryToken = await this.getLockToken(bookRemoteId)
    const second = await this.putStructure(bookRemoteId, chapters, retryToken, token)
    if (second.stale) throw new StaleBookError(second.currentUpdatedAt)
    await this.storeLockToken(bookRemoteId, second.data?.updatedAt)
    return second.data
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
