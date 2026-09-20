import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { GLOBAL_SHORTCUTS } from '@/components/settings/keymap-settings'

/**
 * The toolbar prints a keyboard hint for a control by asking the shortcut
 * registry for the id's current combo, falling back to a hardcoded string when
 * the registry doesn't know the id:
 *
 *   const sk = (id, fallback) => getKeysDisplay(id) ?? fallback
 *
 * That fallback makes an unregistered id indistinguishable from a registered one
 * in the UI — the tooltip renders either way. But nothing handles the keypress,
 * so the combo falls through to the browser: `toggle-read` advertised Ctrl+R and
 * delivered a page reload, dropping the debounced progress write (KAN-316).
 *
 * Source-level assertions rather than a render test, because the failure mode is
 * an id that exists in exactly one place and is therefore invisible to any test
 * that only exercises ids it already knows about.
 */

const TOOLBAR = path.resolve(__dirname, '../reader-toolbar.tsx')
const source = readFileSync(TOOLBAR, 'utf8')

/** Ids the toolbar renders a hint for, via sk('<id>', '<fallback>'). */
function advertisedIds(): string[] {
  return [...source.matchAll(/\bsk\(\s*'([^']+)'/g)].map(m => m[1])
}

/** Ids the toolbar itself registers, via useShortcut('<id>', '<label>', '<keys>'. */
function selfRegistered(): Array<{ id: string; keys: string }> {
  return [...source.matchAll(/useShortcut\(\s*'([^']+)'\s*,\s*'[^']*'\s*,\s*'([^']+)'/g)]
    .map(m => ({ id: m[1], keys: m[2] }))
}

describe('reader toolbar shortcut hints', () => {
  it('finds the sk() call sites it is meant to police', () => {
    // Guard against the regexes silently matching nothing after a refactor,
    // which would turn every assertion below into a vacuous pass.
    expect(advertisedIds().length).toBeGreaterThan(5)
    expect(selfRegistered().length).toBeGreaterThan(0)
  })

  it('advertises no id that is absent from GLOBAL_SHORTCUTS', () => {
    const known = new Set(GLOBAL_SHORTCUTS.map(s => s.id))
    const phantoms = [...new Set(advertisedIds())].filter(id => !known.has(id))
    expect(phantoms).toEqual([])
  })

  it('registers each advertised id with the same combo Settings shows', () => {
    // A default that drifts from GLOBAL_SHORTCUTS would make Settings -> Keymap
    // display one combo while a different one actually fires, and would take the
    // id out of findRemapConflict's reckoning for the combo it really uses.
    for (const { id, keys } of selfRegistered()) {
      const def = GLOBAL_SHORTCUTS.find(s => s.id === id)
      expect(def, `${id} is registered by the toolbar but missing from GLOBAL_SHORTCUTS`).toBeDefined()
      expect(def!.defaultKeys.toLowerCase()).toBe(keys.toLowerCase())
    }
  })

  it('binds no combo the browser needs back', () => {
    // Ctrl+R (reload), Ctrl+S (save page) and Ctrl+F (find in page) are the three
    // this file used to advertise. Registering them would preventDefault the
    // browser action, so a reader-wide binding on any of them is a regression.
    const reserved = ['ctrl+r', 'ctrl+s', 'ctrl+f']
    const bound = selfRegistered().map(s => s.keys.toLowerCase().replace(/\s/g, ''))
    expect(bound.filter(k => reserved.includes(k))).toEqual([])
  })

  it('keeps every fallback string in sync with the registered default', () => {
    // The fallback is what renders on the first paint, before the registration
    // effect lands. If it disagrees with the default the hint briefly lies.
    const fallbacks = new Map(
      [...source.matchAll(/\bsk\(\s*'([^']+)'\s*,\s*'([^']+)'/g)].map(m => [m[1], m[2]]),
    )
    for (const { id, keys } of selfRegistered()) {
      const fallback = fallbacks.get(id)
      expect(fallback, `no sk() fallback found for ${id}`).toBeDefined()
      // Fallbacks use the macOS glyph form (⌃ ⇧ ⌥); compare on the literal key.
      const literal = keys.split('+').pop()!.toLowerCase()
      const rendered = fallback!.replace(/[⌃⇧⌥⌘\s]/g, '').toLowerCase()
      const expected = literal === 'enter' ? '↵' : literal
      expect(rendered, `sk('${id}') fallback "${fallback}" disagrees with "${keys}"`).toBe(expected)
    }
  })
})
