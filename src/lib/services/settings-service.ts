const SETTINGS_KEY = 'bbb-settings'
/** Monotonic local timestamp of the last edit to a server-backed setting. */
const SETTINGS_UPDATED_AT_KEY = 'bbb-settings-updatedAt'
/** Value of SETTINGS_UPDATED_AT_KEY at the last successful push/pull. */
const SETTINGS_SYNCED_AT_KEY = 'bbb-settings-syncedAt'

/** Map of rule id → custom key string (e.g. { 'normal:j': 'ArrowDown' }) */
export type KeymapOverrides = Record<string, string>

/** Supported target languages for word translation */
export type TargetLanguage = 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'ar' | 'hi' | 'vi' | 'th' | 'it'

export const TARGET_LANGUAGES: { code: TargetLanguage; label: string; native: string }[] = [
  { code: 'zh', label: 'Chinese', native: '中文' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', label: 'Thai', native: 'ไทย' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
]

export interface AppSettings {
  anthropicApiKey: string | null
  autoReadThresholdSeconds: number
  defaultViewMode: 'pdf' | 'text' | 'side-by-side'
  trackingMode: 'timer' | 'endofpage'
  readingMode: 'scroll' | 'flip'
  keymapOverrides: KeymapOverrides
  targetLanguage: TargetLanguage
  warnBeforeSync: boolean
}

/**
 * The subset of AppSettings the backend has columns for (nibble-api
 * user_settings / syncSettingsSchema). anthropicApiKey and warnBeforeSync are
 * deliberately excluded: the key is a device-local secret and the warn flag is
 * a per-device UX choice — neither has a server column.
 */
export const SYNCED_SETTING_KEYS = [
  'autoReadThresholdSeconds',
  'defaultViewMode',
  'readingMode',
  'trackingMode',
  'targetLanguage',
  'keymapOverrides',
] as const

export type SyncedSettings = Pick<AppSettings, (typeof SYNCED_SETTING_KEYS)[number]>

const VIEW_MODES: AppSettings['defaultViewMode'][] = ['pdf', 'text', 'side-by-side']
const READING_MODES: AppSettings['readingMode'][] = ['scroll', 'flip']
const TRACKING_MODES: AppSettings['trackingMode'][] = ['timer', 'endofpage']

const DEFAULT_SETTINGS: AppSettings = {
  anthropicApiKey: null,
  autoReadThresholdSeconds: 5,
  defaultViewMode: 'side-by-side',
  trackingMode: 'timer',
  readingMode: 'scroll',
  keymapOverrides: {},
  targetLanguage: 'zh',
  warnBeforeSync: false,
}

export class SettingsService {
  getSettings(): AppSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (!stored) return DEFAULT_SETTINGS
    try {
      const parsed = JSON.parse(stored)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('settings value is not a plain object')
      }
      return { ...DEFAULT_SETTINGS, ...parsed }
    } catch (err) {
      console.warn('[settings-service] discarding corrupt bbb-settings; falling back to defaults', err)
      try { localStorage.removeItem(SETTINGS_KEY) } catch {}
      return DEFAULT_SETTINGS
    }
  }

  updateSettings(partial: Partial<AppSettings>): void {
    const current = this.getSettings()
    const updated = { ...current, ...partial }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      const reason = name === 'QuotaExceededError'
        ? 'browser storage is full'
        : name === 'SecurityError'
          ? 'browser storage is blocked (third-party / private mode)'
          : 'browser storage write failed'
      throw new Error(`Could not save settings: ${reason}.`, { cause: err })
    }

    // Only a server-backed key needs to leave this device. Bump the edit marker
    // (monotonic, so it can never sit at or below the last synced value even if
    // the system clock jumps back) and ask the sync layer to push — without this
    // a preference change would only ever reach localStorage (KAN-288).
    if (SYNCED_SETTING_KEYS.some(k => k in partial)) {
      this.writeNumber(SETTINGS_UPDATED_AT_KEY, Math.max(Date.now(), this.getSettingsUpdatedAt() + 1))
      // Dynamic so settings-service stays a leaf module; markDirty rides the
      // normal 30s debounce, and flushSync() covers a tab closed before it fires.
      import('./sync-service')
        .then(({ syncService }) => syncService.markDirty())
        .catch(err => console.warn('[settings-service] could not schedule settings sync', err))
    }
  }

  getApiKey(): string | null {
    return this.getSettings().anthropicApiKey
  }

  // ── Cloud sync (KAN-288) ──────────────────────────────────────
  //
  // Conflict rule, stated once: both markers below are plain numbers from THIS
  // device's clock, so no client/server clock comparison is ever made.
  //   • push only when dirty — a device with nothing unpushed sends settings:null,
  //     so a stale device cannot clobber newer settings on every poll (or on the
  //     epoch init sync, which would otherwise look like "everything changed").
  //   • pull applies the server row only when NOT dirty — an unpushed local edit
  //     wins until it lands, after which the echoed server row applies idempotently.
  // The server itself applies the blob last-write-wins with no timestamp check.

  private readNumber(key: string): number {
    if (typeof window === 'undefined') return 0
    const raw = localStorage.getItem(key)
    if (raw === null) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  private writeNumber(key: string, value: number): void {
    try { localStorage.setItem(key, String(value)) } catch { /* storage full / blocked */ }
  }

  /** Monotonic timestamp of the last local edit to a synced setting; 0 if never. */
  getSettingsUpdatedAt(): number {
    return this.readNumber(SETTINGS_UPDATED_AT_KEY)
  }

  /** True when this device holds a settings change the server hasn't accepted yet. */
  hasPendingSettingsPush(): boolean {
    if (typeof window === 'undefined') return false
    if (localStorage.getItem(SETTINGS_SYNCED_AT_KEY) === null) {
      // Never synced on this device. Settings that predate settings-sync live
      // only in localStorage, so a stored blob counts as one pending push —
      // this is what backfills existing users' first user_settings row.
      return localStorage.getItem(SETTINGS_KEY) !== null
    }
    return this.getSettingsUpdatedAt() > this.readNumber(SETTINGS_SYNCED_AT_KEY)
  }

  /** The synced subset of local settings, shaped for the POST /api/sync body. */
  getSyncPayload(): SyncedSettings {
    const s = this.getSettings()
    return {
      autoReadThresholdSeconds: s.autoReadThresholdSeconds,
      defaultViewMode: s.defaultViewMode,
      readingMode: s.readingMode,
      trackingMode: s.trackingMode,
      targetLanguage: s.targetLanguage,
      keymapOverrides: s.keymapOverrides,
    }
  }

  /**
   * Record that the settings marker `marker` reached the server. Pass the value
   * read BEFORE the request: an edit made while the request was in flight has a
   * higher marker and must stay dirty rather than be marked clean and lost.
   */
  markSettingsSynced(marker: number): void {
    this.writeNumber(SETTINGS_SYNCED_AT_KEY, marker)
  }

  /** Drop both markers so a different user on this browser starts clean. */
  clearSyncMarkers(): void {
    try {
      localStorage.removeItem(SETTINGS_UPDATED_AT_KEY)
      localStorage.removeItem(SETTINGS_SYNCED_AT_KEY)
    } catch { /* ignore */ }
  }

  /**
   * Merge a user_settings row pulled from the server into local settings.
   * Returns true when a value actually changed.
   *
   * Every field is validated before it is written, so a junk server value can't
   * wedge local settings. localStorage only, no reload: settings are read once
   * on mount, so a pulled change takes effect on the next mount instead of
   * yanking the UI out from under an active reading session.
   *
   * `force` is for the explicit Download-from-Cloud bootstrap, where the cloud
   * is authoritative and the local dirty flag must not veto the restore.
   */
  applyServerSettings(
    row: Record<string, unknown> | null | undefined,
    opts: { force?: boolean } = {},
  ): boolean {
    if (typeof window === 'undefined') return false
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false
    if (!opts.force && this.hasPendingSettingsPush()) return false

    const current = this.getSettings()
    const patch: Partial<AppSettings> = {}

    const threshold = Number(row.autoReadThresholdSeconds)
    if (Number.isInteger(threshold) && threshold >= 1 && threshold <= 3600) {
      patch.autoReadThresholdSeconds = threshold
    }
    if (VIEW_MODES.includes(row.defaultViewMode as AppSettings['defaultViewMode'])) {
      patch.defaultViewMode = row.defaultViewMode as AppSettings['defaultViewMode']
    }
    if (READING_MODES.includes(row.readingMode as AppSettings['readingMode'])) {
      patch.readingMode = row.readingMode as AppSettings['readingMode']
    }
    if (TRACKING_MODES.includes(row.trackingMode as AppSettings['trackingMode'])) {
      patch.trackingMode = row.trackingMode as AppSettings['trackingMode']
    }
    if (TARGET_LANGUAGES.some(l => l.code === row.targetLanguage)) {
      patch.targetLanguage = row.targetLanguage as TargetLanguage
    }
    const overrides = row.keymapOverrides
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      const clean: KeymapOverrides = {}
      for (const [rule, key] of Object.entries(overrides as Record<string, unknown>)) {
        if (typeof key === 'string') clean[rule] = key
      }
      patch.keymapOverrides = clean
    }

    const changed = (Object.keys(patch) as (keyof AppSettings)[]).some(
      k => JSON.stringify(patch[k]) !== JSON.stringify(current[k]),
    )
    if (changed) {
      // Direct write, not updateSettings(): applying a server row must not mark
      // this device dirty and bounce the same values straight back up.
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...current, ...patch }))
      } catch (err) {
        console.warn('[settings-service] could not persist settings pulled from server', err)
        return false
      }
    }
    this.markSettingsSynced(this.getSettingsUpdatedAt())
    return changed
  }
}
