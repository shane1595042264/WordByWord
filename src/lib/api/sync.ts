import { apiClient } from './client'

export interface SyncEntity {
  id: string
  updatedAt: string
  deletedAt?: string | null
  [key: string]: unknown
}

export interface SyncPayload {
  lastSyncedAt: string
  changes: {
    books: SyncEntity[]
    chapters: SyncEntity[]
    sections: SyncEntity[]
    vocabulary: SyncEntity[]
    settings: Record<string, unknown> | null
    exerciseProgress: SyncEntity[]
  }
}

export interface SyncResponse {
  serverChanges: {
    books: SyncEntity[]
    chapters: SyncEntity[]
    sections: SyncEntity[]
    vocabulary: SyncEntity[]
    settings: Record<string, unknown> | null
    exerciseProgress: SyncEntity[]
    exercises: SyncEntity[]
  }
  syncedAt: string
}

export async function syncWithServer(payload: SyncPayload): Promise<SyncResponse> {
  return apiClient<SyncResponse>('/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
