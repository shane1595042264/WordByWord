import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { CloudStatus, SyncResult } from '@/lib/services/sync-service'

// KAN-342: sync() never rejects, so the old `await sync(); setMessage('Sync
// complete.')` showed success for every skip and failure. The panel now maps
// the returned SyncResult to its own message.
const syncAfterInFlight = vi.fn<() => Promise<SyncResult>>()
const forceUpload = vi.fn<() => Promise<SyncResult>>()
const STATUS: CloudStatus = { bookCount: 1, chapterCount: 1, sectionCount: 1, vocabCount: 0, lastUpdated: null, books: [] }
const getCloudStatus = vi.fn<() => Promise<CloudStatus | null>>()

vi.mock('@/lib/services/sync-service', () => ({
  syncService: {
    getCloudStatus: () => getCloudStatus(),
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
    getCloudStatus.mockReset()
    getCloudStatus.mockResolvedValue(STATUS)
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

// KAN-422: every background sync fires nibble:sync-complete, and each refresh
// used to put the whole panel back to 'Checking cloud status...'.
describe('CloudSyncSettings — refreshes after the first load keep the panel', () => {
  beforeEach(() => {
    syncAfterInFlight.mockReset()
    forceUpload.mockReset()
    getCloudStatus.mockReset()
    getCloudStatus.mockResolvedValue(STATUS)
  })

  it('an open confirm survives a background sync-complete while status is pending', async () => {
    render(<CloudSyncSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Force Upload to Cloud' }))
    let resolvePending!: (s: CloudStatus) => void
    getCloudStatus.mockReturnValueOnce(new Promise((r) => { resolvePending = r }))

    act(() => { window.dispatchEvent(new CustomEvent('nibble:sync-complete')) })

    expect(screen.queryByText('Checking cloud status...')).toBeNull()
    expect(screen.getByRole('button', { name: 'Yes, Override Cloud' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sync Now' })).toBeTruthy()

    await act(async () => { resolvePending({ ...STATUS, bookCount: 7 }) })
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Yes, Override Cloud' })).toBeTruthy()
  })

  it('an older status response that resolves last does not overwrite a newer one', async () => {
    render(<CloudSyncSettings />)
    await screen.findByRole('button', { name: 'Sync Now' })
    let resolveOld!: (s: CloudStatus) => void
    getCloudStatus
      .mockReturnValueOnce(new Promise((r) => { resolveOld = r }))
      .mockResolvedValueOnce({ ...STATUS, bookCount: 9 })

    await act(async () => {
      window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
      window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
    })
    expect(screen.getByText('9')).toBeTruthy()
    await act(async () => { resolveOld({ ...STATUS, bookCount: 3 }) })
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.queryByText('3')).toBeNull()
  })

  it('Sync Now: a complete sync is refreshed by its own sync-complete event only', async () => {
    syncAfterInFlight.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
      return { status: 'complete' }
    })
    await clickSyncNow()
    await screen.findByText('Sync complete.')
    // mount + the event's refresh — no second refresh from the click handler
    expect(getCloudStatus).toHaveBeenCalledTimes(2)
  })

  it('Sync Now: a failed sync (no event) still refreshes once itself', async () => {
    syncAfterInFlight.mockResolvedValue({ status: 'failed', reason: 'HTTP 500' })
    await clickSyncNow()
    await screen.findByText('Sync failed. (HTTP 500)')
    expect(getCloudStatus).toHaveBeenCalledTimes(2)
  })

  it('Force Upload: a complete upload does not refresh twice', async () => {
    forceUpload.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent('nibble:sync-complete'))
      return { status: 'complete' }
    })
    await clickForceUpload()
    await screen.findByText('Upload complete. Cloud is now in sync with your local data.')
    expect(getCloudStatus).toHaveBeenCalledTimes(2)
  })
})
