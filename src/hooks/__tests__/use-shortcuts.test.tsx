import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCallback, useRef, type ReactNode } from 'react'
import { ShortcutProvider, useShortcuts, useShortcut } from '../use-shortcuts'
import { SETTINGS_SYNCED_EVENT } from '@/lib/services/settings-service'

const SETTINGS_KEY = 'bbb-settings'

function writeOverrides(overrides: Record<string, string>) {
  const raw = localStorage.getItem(SETTINGS_KEY)
  const settings = raw ? JSON.parse(raw) : {}
  settings.keymapOverrides = overrides
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

function wrapper({ children }: { children: ReactNode }) {
  return <ShortcutProvider>{children}</ShortcutProvider>
}

/**
 * Registers one shortcut and exposes the context. The action identity must be
 * stable: useShortcut re-registers whenever it changes, and re-registering sets
 * provider state, so an inline arrow would loop forever.
 */
function useHarness(fired: { count: number }) {
  const firedRef = useRef(fired)
  firedRef.current = fired
  const action = useCallback(() => { firedRef.current.count++ }, [])
  useShortcut('prev-page', 'Previous page', 'ArrowLeft', action)
  return useShortcuts()
}

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }))
}

describe('ShortcutProvider keymap refresh', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('picks up overrides pulled by sync without a remount', () => {
    const fired = { count: 0 }
    const { result } = renderHook(() => useHarness(fired), { wrapper })

    expect(result.current.getKeys('prev-page')).toBe('ArrowLeft')

    // A sync pull writes straight to localStorage, then fires the synced event.
    act(() => {
      writeOverrides({ 'prev-page': 'Shift+d' })
      window.dispatchEvent(new Event(SETTINGS_SYNCED_EVENT))
    })

    expect(result.current.getKeys('prev-page')).toBe('Shift+d')

    act(() => { press('d', { shiftKey: true }) })
    expect(fired.count).toBe(1)

    // The superseded default must no longer fire.
    act(() => { press('ArrowLeft') })
    expect(fired.count).toBe(1)
  })

  it('still refreshes on the local keymap-changed event', () => {
    const fired = { count: 0 }
    const { result } = renderHook(() => useHarness(fired), { wrapper })

    act(() => {
      writeOverrides({ 'prev-page': 'Ctrl+k' })
      window.dispatchEvent(new Event('keymap-changed'))
    })

    expect(result.current.getKeys('prev-page')).toBe('Ctrl+k')
    act(() => { press('k', { ctrlKey: true }) })
    expect(fired.count).toBe(1)
  })

  it('clears a removed override on a synced pull', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ keymapOverrides: { 'prev-page': 'Shift+d' } }))
    const fired = { count: 0 }
    const { result } = renderHook(() => useHarness(fired), { wrapper })

    expect(result.current.getKeys('prev-page')).toBe('Shift+d')

    act(() => {
      writeOverrides({})
      window.dispatchEvent(new Event(SETTINGS_SYNCED_EVENT))
    })

    expect(result.current.getKeys('prev-page')).toBe('ArrowLeft')
    act(() => { press('ArrowLeft') })
    expect(fired.count).toBe(1)
  })
})
