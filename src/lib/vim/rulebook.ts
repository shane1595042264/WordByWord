/**
 * The Vim Rulebook — all keybindings in one place.
 *
 * Modes:
 *   normal   — word-level cursor + navigation + translate
 *              (h/l word, j/k word-vertical, w/b word, d/u page, gg/G, Enter translate)
 *   sentence — sentence-level selection + translate
 *   visual   — pure vim visual selection (no translation)
 *
 * From normal: s → sentence, v → visual
 * From any non-normal: Escape → normal
 */

import type { VimRule } from './types'

export const RULEBOOK: VimRule[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NORMAL MODE — Word cursor + navigation + translate
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:l',
    label: 'Next word',
    modes: ['normal'],
    key: 'l',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Move cursor to next [count] word(s)',
  },
  {
    id: 'normal:h',
    label: 'Previous word',
    modes: ['normal'],
    key: 'h',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Move cursor to previous [count] word(s)',
  },
  {
    id: 'normal:j',
    label: 'Word down',
    modes: ['normal'],
    key: 'j',
    action: { type: 'select-word-vertical', direction: 1 },
    acceptsCount: true,
    description: 'Move cursor down [count] line(s)',
  },
  {
    id: 'normal:k',
    label: 'Word up',
    modes: ['normal'],
    key: 'k',
    action: { type: 'select-word-vertical', direction: -1 },
    acceptsCount: true,
    description: 'Move cursor up [count] line(s)',
  },
  {
    id: 'normal:w',
    label: 'Next word (alt)',
    modes: ['normal'],
    key: 'w',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Move cursor to next [count] word(s) (same as l)',
  },
  {
    id: 'normal:b',
    label: 'Previous word (alt)',
    modes: ['normal'],
    key: 'b',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Move cursor to previous [count] word(s) (same as h)',
  },
  {
    id: 'normal:d',
    label: 'Half-page down',
    modes: ['normal'],
    key: 'd',
    action: { type: 'scroll', direction: 1, magnitude: 0.5 },
    acceptsCount: true,
    description: 'Scroll down half a page',
  },
  {
    id: 'normal:u',
    label: 'Half-page up',
    modes: ['normal'],
    key: 'u',
    action: { type: 'scroll', direction: -1, magnitude: 0.5 },
    acceptsCount: true,
    description: 'Scroll up half a page',
  },
  {
    id: 'normal:gg',
    label: 'Go to top',
    modes: ['normal', 'sentence', 'visual'],
    key: 'g', // double-tap detection in engine
    action: { type: 'scroll-to', direction: -1 },
    acceptsCount: false,
    description: 'Go to top of document (gg)',
  },
  {
    id: 'normal:G',
    label: 'Go to bottom',
    modes: ['normal'],
    key: 'G',
    shift: true,
    action: { type: 'scroll-to', direction: 1 },
    acceptsCount: false,
    description: 'Go to bottom of document',
  },
  {
    id: 'normal:enter',
    label: 'Translate word',
    modes: ['normal'],
    key: 'Enter',
    action: { type: 'confirm-selection' },
    acceptsCount: false,
    description: 'Show translation for the selected word',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NORMAL MODE — Mode entry
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:s',
    label: 'Enter Sentence mode',
    modes: ['normal'],
    key: 's',
    action: { type: 'mode-change', targetMode: 'sentence' },
    acceptsCount: false,
    description: 'Enter sentence selection mode (translate sentences)',
  },
  {
    id: 'normal:v',
    label: 'Enter Visual mode',
    modes: ['normal'],
    key: 'v',
    action: { type: 'mode-change', targetMode: 'visual' },
    acceptsCount: false,
    description: 'Enter visual selection mode (Vim-style)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ESCAPE — All non-normal modes → normal
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'sentence:escape',
    label: 'Exit Sentence mode',
    modes: ['sentence'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Exit to normal mode, clear selection',
  },
  {
    id: 'visual:escape',
    label: 'Exit Visual mode',
    modes: ['visual'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Exit to normal mode, clear selection',
  },
  {
    id: 'normal:escape',
    label: 'Clear',
    modes: ['normal'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Clear numeric prefix / close panel',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SENTENCE MODE — h/l/j/k + Enter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'sentence:l',
    label: 'Next sentence',
    modes: ['sentence'],
    key: 'l',
    action: { type: 'select-sentence', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] sentence(s)',
  },
  {
    id: 'sentence:h',
    label: 'Previous sentence',
    modes: ['sentence'],
    key: 'h',
    action: { type: 'select-sentence', direction: -1 },
    acceptsCount: true,
    description: 'Select previous [count] sentence(s)',
  },
  {
    id: 'sentence:j',
    label: 'Sentence down',
    modes: ['sentence'],
    key: 'j',
    action: { type: 'select-sentence-vertical', direction: 1 },
    acceptsCount: true,
    description: 'Move sentence selection down [count] line(s)',
  },
  {
    id: 'sentence:k',
    label: 'Sentence up',
    modes: ['sentence'],
    key: 'k',
    action: { type: 'select-sentence-vertical', direction: -1 },
    acceptsCount: true,
    description: 'Move sentence selection up [count] line(s)',
  },
  {
    id: 'sentence:s',
    label: 'Next sentence (alt)',
    modes: ['sentence'],
    key: 's',
    action: { type: 'select-sentence', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] sentence(s) (same as l)',
  },
  {
    id: 'sentence:enter',
    label: 'Translate sentence',
    modes: ['sentence'],
    key: 'Enter',
    action: { type: 'confirm-selection' },
    acceptsCount: false,
    description: 'Show translation for the selected sentence',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // VISUAL MODE — Vim-style selection (no translation)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'visual:l',
    label: 'Extend right',
    modes: ['visual'],
    key: 'l',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Extend selection right by [count] word(s)',
  },
  {
    id: 'visual:h',
    label: 'Extend left',
    modes: ['visual'],
    key: 'h',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Extend selection left by [count] word(s)',
  },
  {
    id: 'visual:j',
    label: 'Extend down',
    modes: ['visual'],
    key: 'j',
    action: { type: 'select-word-vertical', direction: 1 },
    acceptsCount: true,
    description: 'Extend selection down [count] line(s)',
  },
  {
    id: 'visual:k',
    label: 'Extend up',
    modes: ['visual'],
    key: 'k',
    action: { type: 'select-word-vertical', direction: -1 },
    acceptsCount: true,
    description: 'Extend selection up [count] line(s)',
  },
  {
    id: 'visual:w',
    label: 'Extend by word',
    modes: ['visual'],
    key: 'w',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Extend selection forward by [count] word(s)',
  },
  {
    id: 'visual:b',
    label: 'Extend back by word',
    modes: ['visual'],
    key: 'b',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Extend selection backward by [count] word(s)',
  },
  {
    id: 'visual:V',
    label: 'Select line',
    modes: ['visual', 'normal', 'sentence'],
    key: 'V',
    shift: true,
    action: { type: 'select-line' },
    acceptsCount: false,
    description: 'Select the current visual line (Shift+V)',
  },
  {
    id: 'visual:G',
    label: 'Select to bottom',
    modes: ['visual'],
    key: 'G',
    shift: true,
    action: { type: 'select-to-end' },
    acceptsCount: false,
    description: 'Extend selection from current word to end of document',
  },
  {
    id: 'visual:gg',
    label: 'Select to top',
    modes: ['visual'],
    key: 'g', // double-tap detection handles this
    action: { type: 'select-to-start' },
    acceptsCount: false,
    description: 'Extend selection from current word to start of document (gg)',
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
    const isShift = customKey.startsWith('Shift+')
    const actualKey = isShift ? customKey.slice(6) : customKey
    return { ...rule, key: actualKey, shift: isShift || undefined }
  })
}

/**
 * Find a matching rule for a keystroke in the given mode.
 */
export function findRule(mode: string, key: string, shiftKey: boolean, rulebook: VimRule[] = RULEBOOK): VimRule | undefined {
  return rulebook.find(r => {
    if (!r.modes.includes(mode as any)) return false
    if (r.shift) return r.key === key && shiftKey
    return r.key === key && !shiftKey
  })
}
