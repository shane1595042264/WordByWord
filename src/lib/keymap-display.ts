import { useEffect, useState } from 'react'

// ─── Platform-aware keyboard-shortcut display ──────────────────────────────────
//
// Single source of truth for turning a key combo string (e.g. "Ctrl+Shift+l")
// into a human-readable hint. macOS users see the familiar glyphs (⌃ ⇧ ⌥ ⌘);
// every other platform — the primary audience — sees textual modifiers
// (Ctrl / Shift / Alt / Win), since the ⌘ key does not exist on a PC keyboard
// and ⌃ is not the conventional way to denote Ctrl on Windows/Linux.

/** macOS modifier glyphs. */
const MAC_MODIFIERS: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  shift: '⇧',
  alt: '⌥',
  option: '⌥',
  meta: '⌘',
  cmd: '⌘',
  command: '⌘',
}

/** Textual modifiers for Windows/Linux. */
const TEXT_MODIFIERS: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  option: 'Alt',
  meta: 'Win',
  cmd: 'Win',
  command: 'Win',
}

/** Symbols rendered identically on every platform. */
const UNIVERSAL_KEYS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  esc: 'Esc',
  enter: '↵',
  return: '↵',
}

/**
 * Detect macOS in an SSR-safe way. Returns `false` on the server (no navigator)
 * so server-rendered HTML always uses the textual modifiers and matches the
 * first client render on every platform — see {@link useIsMac} for why that
 * matters for hydration.
 */
export function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || navigator.platform || navigator.userAgent || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}

export interface FormatComboOptions {
  /** Override platform detection. Defaults to {@link detectMac}. */
  isMac?: boolean
  /** Separator between parts. Defaults to a space on macOS, '+' otherwise. */
  separator?: string
  /** Uppercase single-character literal keys (e.g. "l" → "L"). */
  upperKeys?: boolean
}

/**
 * Format a key combo ("Ctrl+Shift+l") for display. Pure — pass `isMac`
 * explicitly to keep it deterministic (tests, the keydown provider, etc.).
 */
export function formatKeyCombo(combo: string, opts: FormatComboOptions = {}): string {
  const isMac = opts.isMac ?? detectMac()
  const modifiers = isMac ? MAC_MODIFIERS : TEXT_MODIFIERS
  const separator = opts.separator ?? (isMac ? ' ' : '+')
  return combo
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const lower = part.toLowerCase()
      if (lower in modifiers) return modifiers[lower]
      if (lower in UNIVERSAL_KEYS) return UNIVERSAL_KEYS[lower]
      return opts.upperKeys && part.length === 1 ? part.toUpperCase() : part
    })
    .join(separator)
}

/**
 * Hook variant: returns `false` on the server and during the first client
 * render, then flips to the real value after mount. This keeps the initial
 * client render identical to the SSR output (both textual), so macOS clients
 * don't trip a hydration mismatch on the inline shortcut hints — they simply
 * re-render with glyphs once mounted.
 */
export function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    setIsMac(detectMac())
  }, [])
  return isMac
}
