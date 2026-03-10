const SETTINGS_KEY = 'bbb-settings'

/** Map of rule id → custom key string (e.g. { 'normal:j': 'ArrowDown' }) */
export type KeymapOverrides = Record<string, string>

export interface AppSettings {
  anthropicApiKey: string | null
  autoReadThresholdSeconds: number
  defaultViewMode: 'pdf' | 'text' | 'side-by-side'
  trackingMode: 'timer' | 'endofpage'
  readingMode: 'scroll' | 'flip'
  keymapOverrides: KeymapOverrides
}

const DEFAULT_SETTINGS: AppSettings = {
  anthropicApiKey: null,
  autoReadThresholdSeconds: 5,
  defaultViewMode: 'side-by-side',
  trackingMode: 'timer',
  readingMode: 'scroll',
  keymapOverrides: {},
}

export class SettingsService {
  getSettings(): AppSettings {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (!stored) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  }

  updateSettings(partial: Partial<AppSettings>): void {
    const current = this.getSettings()
    const updated = { ...current, ...partial }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
  }

  getApiKey(): string | null {
    return this.getSettings().anthropicApiKey
  }
}
