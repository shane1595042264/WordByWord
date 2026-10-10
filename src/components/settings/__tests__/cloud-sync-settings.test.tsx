import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { SyncResult } from '@/lib/services/sync-service'

// KAN-342: sync() never rejects, so the old `await sync(); setMessage('Sync
// complete.')` showed success for every skip and failure. The panel now maps
// the returned SyncResult to its own message.
const syncAfterInFlight = vi.fn<() => Promise<SyncResult>>()
const forceUpload = vi.fn<() => Promise<SyncResult>>()

vi.mock('@/lib/services/sync-service', () => ({
  syncService: {
    getCloudStatus: async () => ({ bookCount: 1, chapterCount: 1, sectionCount: 1, vocabCount: 0, lastUpdated: null, books: [] }),
    getLastSyncedAt: () => null,
    syncAfterInFlight: () => syncAfterInFlight(),
    forceUpload: () => forceUpload(),
  },
}))

import { CloudSyncSettings } from '../cloud-sync-settings'

async function clickSyncNow() {
  render(<CloudSyncSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'Sync Now' }))
}

async function clickForceUpload() {
  render(<CloudSyncSettings />)
  fireEvent.click(await screen.findByRole('button', { name: 'Force Upload to Cloud' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, Override Cloud' }))
}

describe('CloudSyncSettings — messages follow the real sync outcome', () => {
  beforeEach(() => {
    syncAfterInFlight.mockReset()
    forceUpload.mockReset()
  })

  it('Sync Now: complete says complete', async () => {
    syncAfterInFlight.mockResolvedValue({ status: 'complete' })
    await clickSyncNow()
    expect(await screen.findByText('Sync complete.')).toBeTruthy()
  })

  it('Sync Now: an HTTP failure says failed, not complete', async () => {
    syncAfterInFlight.mockResolvedValue({ status: 'failed', reason: 'Sync request failed: HTTP 500' })
    await clickSyncNow()
    expect(await screen.findByText('Sync failed. (Sync request failed: HTTP 500)')).toBeTruthy()
    expect(screen.queryByText('Sync complete.')).toBeNull()
  })

  it('Sync Now: a missing token says the session expired', async () => {
    syncAfterInFlight.mockResolvedValue({ status: 'skipped', reason: 'no-token' })
    await clickSyncNow()
    expect(await screen.findByText(/Sync did not run — you are signed out or your session expired/)).toBeTruthy()
  })

  it('Sync Now: partial reports the problem', async () => {
    syncAfterInFlight.mockResolvedValue({ status: 'partial', reason: '2 items will retry' })
    await clickSyncNow()
    expect(await screen.findByText('Sync finished with problems: 2 items will retry.')).toBeTruthy()
  })

  it('Force Upload: complete promises the cloud matches local', async () => {
    forceUpload.mockResolvedValue({ status: 'complete' })
    await clickForceUpload()
    expect(await screen.findByText('Upload complete. Cloud is now in sync with your local data.')).toBeTruthy()
  })

  it('Force Upload: a failure warns the cloud may be out of sync', async () => {
    forceUpload.mockResolvedValue({ status: 'failed', reason: 'network down' })
    await clickForceUpload()
    expect(await screen.findByText('Upload failed — your cloud may be out of sync. (network down)')).toBeTruthy()
    expect(screen.queryByText(/Upload complete/)).toBeNull()
  })

  it('Force Upload: a missing token does not claim success', async () => {
    forceUpload.mockResolvedValue({ status: 'skipped', reason: 'no-token' })
    await clickForceUpload()
    expect(await screen.findByText(/Upload did not run — you are signed out or your session expired/)).toBeTruthy()
  })
})
