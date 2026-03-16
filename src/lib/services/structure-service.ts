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

  async saveStructure(bookRemoteId: string, chapters: ChapterStructure[]) {
    const token = await this.getToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch(`${this.getApiUrl()}/books/${bookRemoteId}/structure`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ chapters }),
    })
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
