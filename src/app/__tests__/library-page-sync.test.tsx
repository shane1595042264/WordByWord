import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

// KAN-401: the library's onProcessingComplete and Sync Now called sync(), which
// resolves 'skipped' while another sync is in flight. The in-flight sync took its
// snapshot before the job finished, so the card stayed on 'Complete!' until reload.

// Mirrors the real sync() / syncAfterInFlight() contract (covered in sync-service.test.ts):
// sync() skips while a sync is in flight; syncAfterInFlight() waits it out and then runs.
const fakeSync = {
  inFlight: null as Promise<unknown> | null,
  realRuns: 0,
  forcedFull: false,
  forcedFullAtRun: [] as boolean[],
  async sync() {
    if (this.inFlight) return { status: 'skipped', reason: 'in-progress' }
    this.realRuns++
    this.forcedFullAtRun.push(this.forcedFull)
    this.forcedFull = false
    return { status: 'complete' }
  },
  async syncAfterInFlight() {
    while (this.inFlight) await this.inFlight
    return this.sync()
  },
  forceFullSyncNext() { this.forcedFull = true },
  getLastSyncedAt: () => null,
}

vi.mock('@/lib/services/sync-service', () => ({ syncService: fakeSync }))

const refresh = vi.fn()
vi.mock('@/hooks/use-books', () => ({
  useBooks: () => ({ books: [], loading: false, error: null, refresh }),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated' }) }))
vi.mock('@/hooks/use-sync-status', () => ({ useSyncStatus: () => ({ isSyncing: false, progress: null }) }))
vi.mock('@/components/library/upload-dialog', () => ({ UploadDialog: () => null }))
vi.mock('@/components/auth/user-menu', () => ({ UserMenu: () => null }))
vi.mock('@/components/library/delete-confirm-dialog', () => ({ DeleteConfirmDialog: () => null }))
vi.mock('@/components/library/library-grid', () => ({
  LibraryGrid: ({ onProcessingComplete }: { onProcessingComplete?: () => void }) => (
    <button onClick={() => onProcessingComplete?.()}>fire-processing-complete</button>
  ),
}))

import HomePage from '../page'

function holdInFlightSync() {
  let release!: () => void
  fakeSync.inFlight = new Promise<void>(r => { release = r }).then(() => { fakeSync.inFlight = null })
  return () => release()
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) })

describe('Library page — syncs triggered during an in-flight sync still run (KAN-401)', () => {
  // The handlers `await import()` the sync service; warm the module cache so the
  // first test's import resolves inside flush() like the later tests' do.
  beforeAll(async () => { await import('@/lib/services/sync-service') })

  beforeEach(() => {
    fakeSync.inFlight = null
    fakeSync.realRuns = 0
    fakeSync.forcedFull = false
    fakeSync.forcedFullAtRun = []
    refresh.mockReset()
  })

  it('onProcessingComplete runs a full sync after the in-flight one settles, then refreshes', async () => {
    render(<HomePage />)
    const release = holdInFlightSync()

    fireEvent.click(await screen.findByText('fire-processing-complete'))
    await flush()
    expect(fakeSync.realRuns).toBe(0)
    expect(refresh).not.toHaveBeenCalled()

    release()
    await flush()
    expect(fakeSync.realRuns).toBe(1)
    expect(fakeSync.forcedFullAtRun).toEqual([true])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('Sync Now pressed during an in-flight sync runs a real sync once it settles', async () => {
    render(<HomePage />)
    const release = holdInFlightSync()

    fireEvent.click(await screen.findByRole('button', { name: /sync now/i }))
    await flush()
    expect(fakeSync.realRuns).toBe(0)

    release()
    await flush()
    expect(fakeSync.realRuns).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('control: with nothing in flight, onProcessingComplete syncs immediately', async () => {
    render(<HomePage />)
    fireEvent.click(await screen.findByText('fire-processing-complete'))
    await flush()
    expect(fakeSync.realRuns).toBe(1)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
