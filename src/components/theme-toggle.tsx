'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  applyTheme,
  darkSchemeQuery,
  readThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '@/lib/theme'

const NEXT: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const LABEL: Record<ThemePreference, string> = {
  system: 'Theme: match system',
  light: 'Theme: light',
  dark: 'Theme: dark',
}

/** Fired on this tab when the choice changes; 'storage' covers other tabs. */
const THEME_EVENT = 'nibble:theme-change'

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return
    applyTheme(readThemePreference())
    onChange()
  }
  window.addEventListener(THEME_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(THEME_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

// The server cannot know the stored choice (the init script has already
// painted the right theme), so it renders the neutral icon hidden.
const serverSnapshot = () => null

/** One button that cycles system, light, dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const preference = useSyncExternalStore<ThemePreference | null>(subscribe, readThemePreference, serverSnapshot)

  // While following the system, follow it live.
  useEffect(() => {
    if (preference !== 'system') return
    const query = darkSchemeQuery()
    if (!query) return
    const onChange = () => applyTheme('system')
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const cycle = useCallback(() => {
    const next = NEXT[readThemePreference()]
    saveThemePreference(next)
    applyTheme(next)
    window.dispatchEvent(new Event(THEME_EVENT))
  }, [])

  const current = preference ?? 'system'
  const Icon = current === 'light' ? SunIcon : current === 'dark' ? MoonIcon : MonitorIcon

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={cycle}
      aria-label={LABEL[current]}
      title={LABEL[current]}
      className={className}
    >
      <Icon className={preference === null ? 'opacity-0' : undefined} />
    </Button>
  )
}
