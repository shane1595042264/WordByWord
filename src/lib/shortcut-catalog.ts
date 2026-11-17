import { GLOBAL_SHORTCUTS, effectiveVimCombo } from '@/components/settings/keymap-settings'
import { RULEBOOK } from '@/lib/vim/rulebook'
import type { KeymapOverrides } from '@/lib/services/settings-service'

/** One row of the ? dialog: a global shortcut or a Vim rule, with the keys it fires on now. */
export interface ShortcutEntry {
  id: string
  label: string
  description: string
  /** "Global" for app-wide shortcuts, otherwise the Vim modes, e.g. "Normal / Sentence". */
  scope: string
  /** The effective combo (user override wins over the default). */
  keys: string
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Every shortcut the app has, in the order Settings > Keymap lists them. */
export function buildShortcutCatalog(overrides: KeymapOverrides): ShortcutEntry[] {
  return [
    ...GLOBAL_SHORTCUTS.map(s => ({
      id: s.id,
      label: s.label,
      description: s.description,
      scope: 'Global',
      keys: overrides[s.id] || s.defaultKeys,
    })),
    ...RULEBOOK.map(r => ({
      id: r.id,
      label: r.label,
      description: r.description,
      scope: r.modes.map(capitalize).join(' / '),
      keys: effectiveVimCombo(r, overrides),
    })),
  ]
}

/**
 * Plain-word search: every word of the query must appear somewhere in the
 * entry (name, description, scope or keys), so "toggle sidebar" finds "Toggle
 * Sections Panel / Collapse or expand the sections sidebar". Questions phrased
 * in other words ("how do I change modes") are what the AI fallback is for.
 */
export function matchShortcuts(entries: ShortcutEntry[], query: string): ShortcutEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return entries
  return entries.filter(e => {
    const haystack = `${e.label} ${e.description} ${e.scope} ${e.keys} ${e.id}`.toLowerCase()
    return words.every(w => haystack.includes(w))
  })
}

/**
 * What the AI fallback is told about each entry. Vim rules only fire in the
 * reader, in the mode named, so say so: "how do I switch modes" should not be
 * answered with a key that does nothing on the page the reader is asking from.
 */
export function describeForAi(e: ShortcutEntry): { id: string; label: string; description: string } {
  const where = e.scope === 'Global' ? 'works anywhere in the app' : `Vim key in the reader, ${e.scope} mode`
  return { id: e.id, label: e.label, description: `${e.description} (${where}; key: ${e.keys})` }
}
