'use client'

import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShortcutAction {
  id: string
  label: string
  /** Default key combo, e.g. "Ctrl+Shift+P" */
  defaultKeys: string
  /** User-customized key combo (if changed) */
  customKeys?: string
  /** The callback to run when shortcut fires */
  action: () => void
}

interface ShortcutContextValue {
  /** Register a shortcut action */
  register: (shortcut: ShortcutAction) => void
  /** Unregister a shortcut by id */
  unregister: (id: string) => void
  /** Get the current key combo for a shortcut */
  getKeys: (id: string) => string | undefined
  /** Get a display-friendly label for a shortcut's keys */
  getKeysDisplay: (id: string) => string | undefined
  /** Reassign a shortcut's keys */
  reassign: (id: string, newKeys: string) => void
  /** Get all registered shortcuts */
  getAll: () => ShortcutAction[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wbw-keyboard-shortcuts'

/** Parse "Ctrl+Shift+K" into parts */
function parseCombo(combo: string): { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean; key: string } {
  const parts = combo.split('+').map(p => p.trim().toLowerCase())
  return {
    ctrl: parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    meta: parts.includes('meta') || parts.includes('cmd'),
    key: parts.filter(p => !['ctrl', 'shift', 'alt', 'meta', 'cmd'].includes(p))[0] || '',
  }
}

/** Format a key combo for display (with nice symbols) */
function formatComboDisplay(combo: string): string {
  return combo
    .replace(/ctrl/i, '⌃')
    .replace(/shift/i, '⇧')
    .replace(/alt/i, '⌥')
    .replace(/meta|cmd/i, '⌘')
    .replace(/\+/g, ' ')
    .replace(/arrowup/i, '↑')
    .replace(/arrowdown/i, '↓')
    .replace(/arrowleft/i, '←')
    .replace(/arrowright/i, '→')
    .toUpperCase()
}

function matchesEvent(combo: string, e: KeyboardEvent): boolean {
  const parsed = parseCombo(combo)
  return (
    e.ctrlKey === parsed.ctrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    e.metaKey === parsed.meta &&
    e.key.toLowerCase() === parsed.key
  )
}

function loadCustomMappings(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveCustomMappings(mappings: Record<string, string>) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings))
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ShortcutContext = createContext<ShortcutContextValue | null>(null)

export function ShortcutProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Map<string, ShortcutAction>>(new Map())
  const [customMappings, setCustomMappings] = useState<Record<string, string>>(loadCustomMappings)

  const register = useCallback((shortcut: ShortcutAction) => {
    setShortcuts(prev => {
      const next = new Map(prev)
      // Apply custom mapping if exists
      const custom = customMappings[shortcut.id]
      next.set(shortcut.id, custom ? { ...shortcut, customKeys: custom } : shortcut)
      return next
    })
  }, [customMappings])

  const unregister = useCallback((id: string) => {
    setShortcuts(prev => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  const getKeys = useCallback((id: string) => {
    const s = shortcuts.get(id)
    return s ? (s.customKeys || s.defaultKeys) : undefined
  }, [shortcuts])

  const getKeysDisplay = useCallback((id: string) => {
    const keys = getKeys(id)
    return keys ? formatComboDisplay(keys) : undefined
  }, [getKeys])

  const reassign = useCallback((id: string, newKeys: string) => {
    setCustomMappings(prev => {
      const next = { ...prev, [id]: newKeys }
      saveCustomMappings(next)
      return next
    })
    setShortcuts(prev => {
      const next = new Map(prev)
      const existing = next.get(id)
      if (existing) {
        next.set(id, { ...existing, customKeys: newKeys })
      }
      return next
    })
  }, [])

  const getAll = useCallback(() => [...shortcuts.values()], [shortcuts])

  // Global keydown handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      for (const shortcut of shortcuts.values()) {
        const combo = shortcut.customKeys || shortcut.defaultKeys
        if (matchesEvent(combo, e)) {
          e.preventDefault()
          e.stopPropagation()
          shortcut.action()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts])

  return (
    <ShortcutContext.Provider value={{ register, unregister, getKeys, getKeysDisplay, reassign, getAll }}>
      {children}
    </ShortcutContext.Provider>
  )
}

export function useShortcuts() {
  const ctx = useContext(ShortcutContext)
  if (!ctx) throw new Error('useShortcuts must be used within ShortcutProvider')
  return ctx
}

/**
 * Hook: register a keyboard shortcut for the lifetime of the component.
 */
export function useShortcut(id: string, label: string, defaultKeys: string, action: () => void) {
  const { register, unregister } = useShortcuts()

  useEffect(() => {
    register({ id, label, defaultKeys, action })
    return () => unregister(id)
  }, [id, label, defaultKeys, action, register, unregister])
}
