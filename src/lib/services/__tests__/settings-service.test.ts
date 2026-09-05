import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsService, SYNCED_SETTING_KEYS } from '../settings-service'

// Coverage for KAN-288: settings never reached the cloud in either direction.
// These tests pin the conflict rule — push only when dirty, pull only when
// clean — because getting it wrong silently overwrites a user's preferences.

const markDirty = vi.fn()
vi.mock('../sync-service', () => ({ syncService: { markDirty: () => markDirty() } }))

const SETTINGS_KEY = 'bbb-settings'
const UPDATED_AT_KEY = 'bbb-settings-updatedAt'
const SYNCED_AT_KEY = 'bbb-settings-syncedAt'

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    autoReadThresholdSeconds: 12,
    defaultViewMode: 'text',
    readingMode: 'flip',
    trackingMode: 'endofpage',
    targetLanguage: 'ja',
    keymapOverrides: { 'prev-page': 'Shift+d' },
    updatedAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  }
}

describe('SettingsService cloud sync (KAN-288)', () => {
  let svc: SettingsService

  beforeEach(() => {
    localStorage.clear()
    markDirty.mockClear()
    svc = new SettingsService()
  })

  describe('dirty tracking', () => {
    it('a virgin device has nothing to push', () => {
      expect(svc.hasPendingSettingsPush()).toBe(false)
    })

    it('backfills once: settings that predate sync count as a pending push', () => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ defaultViewMode: 'text' }))
      expect(svc.hasPendingSettingsPush()).toBe(true)
    })

    it('changing a synced key marks dirty and asks sync to push', async () => {
      svc.updateSettings({ defaultViewMode: 'text' })
      expect(svc.hasPendingSettingsPush()).toBe(true)
      expect(svc.getSettingsUpdatedAt()).toBeGreaterThan(0)
      // markDirty is reached through a dynamic import — let the microtask land.
      await vi.waitFor(() => expect(markDirty).toHaveBeenCalled())
    })

    it('changing a device-local key does not dirty the cloud state', async () => {
      svc.markSettingsSynced(svc.getSettingsUpdatedAt())
      svc.updateSettings({ anthropicApiKey: 'sk-local', warnBeforeSync: true })
      expect(svc.hasPendingSettingsPush()).toBe(false)
      await Promise.resolve()
      expect(markDirty).not.toHaveBeenCalled()
    })

    it('markSettingsSynced clears the flag', () => {
      svc.updateSettings({ readingMode: 'flip' })
      svc.markSettingsSynced(svc.getSettingsUpdatedAt())
      expect(svc.hasPendingSettingsPush()).toBe(false)
    })

    it('an edit made while the push is in flight stays dirty', () => {
      svc.updateSettings({ readingMode: 'flip' })
      const markerSentWithRequest = svc.getSettingsUpdatedAt()
      svc.updateSettings({ trackingMode: 'endofpage' }) // lands mid-request
      svc.markSettingsSynced(markerSentWithRequest)
      expect(svc.hasPendingSettingsPush()).toBe(true)
    })

    it('the marker is monotonic even if the system clock jumps backwards', () => {
      localStorage.setItem(UPDATED_AT_KEY, String(Date.now() + 60_000))
      const before = svc.getSettingsUpdatedAt()
      svc.updateSettings({ readingMode: 'flip' })
      expect(svc.getSettingsUpdatedAt()).toBeGreaterThan(before)
    })

    it('clearSyncMarkers wipes both markers so a second user starts clean', () => {
      svc.updateSettings({ readingMode: 'flip' })
      svc.markSettingsSynced(svc.getSettingsUpdatedAt())
      svc.clearSyncMarkers()
      expect(localStorage.getItem(UPDATED_AT_KEY)).toBeNull()
      expect(localStorage.getItem(SYNCED_AT_KEY)).toBeNull()
    })
  })

  describe('getSyncPayload', () => {
    it('sends exactly the six server-backed keys', () => {
      svc.updateSettings({ anthropicApiKey: 'sk-secret', warnBeforeSync: true })
      const payload = svc.getSyncPayload()
      expect(Object.keys(payload).sort()).toEqual([...SYNCED_SETTING_KEYS].sort())
      expect(payload).not.toHaveProperty('anthropicApiKey')
      expect(payload).not.toHaveProperty('warnBeforeSync')
    })
  })

  describe('applyServerSettings', () => {
    it('restores every synced field on a clean device (new-device case)', () => {
      expect(svc.applyServerSettings(serverRow())).toBe(true)
      const s = svc.getSettings()
      expect(s.autoReadThresholdSeconds).toBe(12)
      expect(s.defaultViewMode).toBe('text')
      expect(s.readingMode).toBe('flip')
      expect(s.trackingMode).toBe('endofpage')
      expect(s.targetLanguage).toBe('ja')
      expect(s.keymapOverrides).toEqual({ 'prev-page': 'Shift+d' })
    })

    it('does not mark the device dirty, so pulled values are not bounced back up', () => {
      svc.applyServerSettings(serverRow())
      expect(svc.hasPendingSettingsPush()).toBe(false)
    })

    it('leaves device-local keys untouched', () => {
      svc.updateSettings({ anthropicApiKey: 'sk-local', warnBeforeSync: true })
      svc.applyServerSettings(serverRow())
      expect(svc.getSettings().anthropicApiKey).toBe('sk-local')
      expect(svc.getSettings().warnBeforeSync).toBe(true)
    })

    it('an unpushed local edit wins over the server row', () => {
      svc.updateSettings({ defaultViewMode: 'pdf' })
      expect(svc.applyServerSettings(serverRow())).toBe(false)
      expect(svc.getSettings().defaultViewMode).toBe('pdf')
    })

    it('force overrides the local edit (Download from Cloud is cloud-wins)', () => {
      svc.updateSettings({ defaultViewMode: 'pdf' })
      expect(svc.applyServerSettings(serverRow(), { force: true })).toBe(true)
      expect(svc.getSettings().defaultViewMode).toBe('text')
    })

    it('drops invalid values instead of wedging local settings', () => {
      svc.applyServerSettings(serverRow({
        autoReadThresholdSeconds: 99999,
        defaultViewMode: 'hologram',
        readingMode: null,
        trackingMode: 42,
        targetLanguage: 'klingon',
        keymapOverrides: ['not', 'an', 'object'],
      }))
      const s = svc.getSettings()
      expect(s.autoReadThresholdSeconds).toBe(5)
      expect(s.defaultViewMode).toBe('side-by-side')
      expect(s.readingMode).toBe('scroll')
      expect(s.trackingMode).toBe('timer')
      expect(s.targetLanguage).toBe('zh')
      expect(s.keymapOverrides).toEqual({})
    })

    it('drops non-string keymap values but keeps the good ones', () => {
      svc.applyServerSettings(serverRow({ keymapOverrides: { 'prev-page': 'Shift+d', 'next-page': 7 } }))
      expect(svc.getSettings().keymapOverrides).toEqual({ 'prev-page': 'Shift+d' })
    })

    it('is a no-op for a null / absent / non-object server blob', () => {
      expect(svc.applyServerSettings(null)).toBe(false)
      expect(svc.applyServerSettings(undefined)).toBe(false)
      expect(svc.applyServerSettings([] as unknown as Record<string, unknown>)).toBe(false)
      expect(localStorage.getItem(SETTINGS_KEY)).toBeNull()
    })

    it('reports no change when the server row already matches local', () => {
      svc.applyServerSettings(serverRow())
      expect(svc.applyServerSettings(serverRow())).toBe(false)
      expect(svc.getSettings().defaultViewMode).toBe('text')
    })
  })
})
