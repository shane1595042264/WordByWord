/**
 * Light / dark theme. Local to this browser on purpose: it is a display
 * preference, not reading data, so it stays out of SettingsService and sync.
 *
 * 'system' (the default) follows prefers-color-scheme live.
 */

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_STORAGE_KEY = 'nibble_theme'

const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system'
  } catch {
    return 'system'
  }
}

/** The dark-scheme media query, or null where matchMedia is missing (jsdom, old embeds). */
export function darkSchemeQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-color-scheme: dark)')
}

export function systemPrefersDark(): boolean {
  return darkSchemeQuery()?.matches ?? false
}

/** Put the resolved theme on <html>. Returns whether dark is now active. */
export function applyTheme(preference: ThemePreference): boolean {
  const dark = preference === 'dark' || (preference === 'system' && systemPrefersDark())
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage blocked (private mode): the choice still applies for this page.
  }
}

/**
 * Inlined into <head> by the root layout so the class is set before first
 * paint. Mirrors readThemePreference + applyTheme; keep the two in step.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;if(d)r.classList.add('dark');r.style.colorScheme=d?'dark':'light'}catch(e){}})()`
