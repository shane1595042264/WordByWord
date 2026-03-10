/**
 * The Vim Rulebook — all keybindings in one place.
 *
 * To add a new binding:
 *   1. Add a VimRule object to RULEBOOK
 *   2. If it needs a new action type, add it to VimActionType in types.ts
 *   3. Handle the new action type in the engine's dispatch function
 *
 * That's it. The engine, UI, and help overlay all read from this array.
 */

import type { VimRule } from './types'

export const RULEBOOK: VimRule[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NORMAL MODE — Navigation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:j',
    label: 'Scroll down',
    modes: ['normal'],
    key: 'j',
    action: { type: 'scroll', direction: 1, magnitude: 1 },
    acceptsCount: true,
    description: 'Scroll down [count] lines',
  },
  {
    id: 'normal:k',
    label: 'Scroll up',
    modes: ['normal'],
    key: 'k',
    action: { type: 'scroll', direction: -1, magnitude: 1 },
    acceptsCount: true,
    description: 'Scroll up [count] lines',
  },
  {
    id: 'normal:d',
    label: 'Half-page down',
    modes: ['normal'],
    key: 'd',
    action: { type: 'scroll', direction: 1, magnitude: 0.5 }, // 0.5 = half viewport
    acceptsCount: true,
    description: 'Scroll down half a page (Ctrl+D in Vim)',
  },
  {
    id: 'normal:u',
    label: 'Half-page up',
    modes: ['normal'],
    key: 'u',
    action: { type: 'scroll', direction: -1, magnitude: 0.5 },
    acceptsCount: true,
    description: 'Scroll up half a page (Ctrl+U in Vim)',
  },
  {
    id: 'normal:gg',
    label: 'Go to top',
    modes: ['normal'],
    key: 'g', // handled specially — double-tap detection in engine
    action: { type: 'scroll-to', direction: -1 },
    acceptsCount: false,
    description: 'Scroll to top of document (gg in Vim)',
  },
  {
    id: 'normal:G',
    label: 'Go to bottom',
    modes: ['normal'],
    key: 'G',
    shift: true,
    action: { type: 'scroll-to', direction: 1 },
    acceptsCount: false,
    description: 'Scroll to bottom of document',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MODE SWITCHING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:enter-select',
    label: 'Enter Select mode',
    modes: ['normal'],
    key: 'v',
    action: { type: 'mode-change', targetMode: 'select' },
    acceptsCount: false,
    description: 'Enter Select mode (like Visual mode in Vim)',
  },
  {
    id: 'select:escape',
    label: 'Exit Select mode',
    modes: ['select'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Exit Select mode, clear selection',
  },
  {
    id: 'normal:escape',
    label: 'Clear count / reset',
    modes: ['normal'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Clear numeric prefix buffer',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SELECT MODE — Word selection
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'select:w',
    label: 'Next word',
    modes: ['select'],
    key: 'w',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] word(s)',
  },
  {
    id: 'select:b',
    label: 'Previous word',
    modes: ['select'],
    key: 'b',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Select previous [count] word(s)',
  },
  {
    id: 'select:e',
    label: 'End of word',
    modes: ['select'],
    key: 'e',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Move to end of word (same as w)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SELECT MODE — Sentence selection
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'select:s',
    label: 'Next sentence',
    modes: ['select'],
    key: 's',
    action: { type: 'select-sentence', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] sentence(s)',
  },
  {
    id: 'select:S',
    label: 'Previous sentence',
    modes: ['select'],
    key: 'S',
    shift: true,
    action: { type: 'select-sentence', direction: -1 },
    acceptsCount: true,
    description: 'Select previous [count] sentence(s)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SELECT MODE — Line selection (V)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'select:V',
    label: 'Select line',
    modes: ['select', 'normal'],
    key: 'V',
    shift: true,
    action: { type: 'select-line' },
    acceptsCount: false,
    description: 'Select the current visual line (Shift+V)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SELECT MODE — Confirm (Enter to show word info)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'select:enter',
    label: 'Show word info',
    modes: ['select'],
    key: 'Enter',
    action: { type: 'confirm-selection' },
    acceptsCount: false,
    description: 'Show info panel for the currently selected word',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SELECT MODE — Navigation (same as normal)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'select:j',
    label: 'Move selection down',
    modes: ['select'],
    key: 'j',
    action: { type: 'select-word-vertical', direction: 1 },
    acceptsCount: true,
    description: 'Move word cursor down [count] line(s)',
  },
  {
    id: 'select:k',
    label: 'Move selection up',
    modes: ['select'],
    key: 'k',
    action: { type: 'select-word-vertical', direction: -1 },
    acceptsCount: true,
    description: 'Move word cursor up [count] line(s)',
  },
]

/**
 * Get all rules for a specific mode.
 */
export function getRulesForMode(mode: string): VimRule[] {
  return RULEBOOK.filter(r => r.modes.includes(mode as any))
}

/**
 * Apply user keymap overrides to produce an effective rulebook.
 * Overrides is a map of ruleId -> custom key string.
 */
export function getEffectiveRulebook(overrides: Record<string, string>): VimRule[] {
  if (!overrides || Object.keys(overrides).length === 0) return RULEBOOK
  return RULEBOOK.map(rule => {
    const customKey = overrides[rule.id]
    if (!customKey) return rule
    // Parse the custom key — detect shift from the key name
    const isShift = customKey.startsWith('Shift+')
    const actualKey = isShift ? customKey.slice(6) : customKey
    return { ...rule, key: actualKey, shift: isShift || undefined }
  })
}

/**
 * Find a matching rule for a keystroke in the given mode.
 * Uses the provided rulebook (which may include user overrides).
 */
export function findRule(mode: string, key: string, shiftKey: boolean, rulebook: VimRule[] = RULEBOOK): VimRule | undefined {
  return rulebook.find(r => {
    if (!r.modes.includes(mode as any)) return false
    // For shift-specific rules, match exactly
    if (r.shift) {
      return r.key === key && shiftKey
    }
    // For non-shift rules, only match when shift is NOT held (unless the key itself implies shift)
    return r.key === key && !shiftKey
  })
}
