const SETTINGS_KEY = 'bbb-settings'

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
