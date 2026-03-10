/**
 * The Vim Rulebook — all keybindings in one place.
 *
 * Modes:
 *   normal   — navigation (j/k cursor, d/u half-page, gg/G)
 *   word     — word-level selection + translation
 *   sentence — sentence-level selection + translation
 *   visual   — pure vim visual selection (no translation)
 *
 * From normal: w → word, s → sentence, v → visual
 * From any non-normal: Escape → normal
 */

import type { VimRule } from './types'

export const RULEBOOK: VimRule[] = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NORMAL MODE — Navigation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:j',
    label: 'Cursor down',
    modes: ['normal'],
    key: 'j',
    action: { type: 'cursor-line', direction: 1 },
    acceptsCount: true,
    description: 'Move cursor down [count] line(s)',
  },
  {
    id: 'normal:k',
    label: 'Cursor up',
    modes: ['normal'],
    key: 'k',
    action: { type: 'cursor-line', direction: -1 },
    acceptsCount: true,
    description: 'Move cursor up [count] line(s)',
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
    modes: ['normal'],
    key: 'g', // double-tap detection in engine
    action: { type: 'scroll-to', direction: -1 },
    acceptsCount: false,
    description: 'Scroll to top of document (gg)',
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
  // NORMAL MODE — Mode entry
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'normal:w',
    label: 'Enter Word mode',
    modes: ['normal'],
    key: 'w',
    action: { type: 'mode-change', targetMode: 'word' },
    acceptsCount: false,
    description: 'Enter word selection mode (translate words)',
  },
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
    id: 'word:escape',
    label: 'Exit Word mode',
    modes: ['word'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Exit to normal mode, clear selection',
  },
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
    label: 'Clear count',
    modes: ['normal'],
    key: 'Escape',
    action: { type: 'escape' },
    acceptsCount: false,
    description: 'Clear numeric prefix buffer',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WORD MODE — h/l/j/k + Enter
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  {
    id: 'word:l',
    label: 'Next word',
    modes: ['word'],
    key: 'l',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] word(s)',
  },
  {
    id: 'word:h',
    label: 'Previous word',
    modes: ['word'],
    key: 'h',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Select previous [count] word(s)',
  },
  {
    id: 'word:j',
    label: 'Word down',
    modes: ['word'],
    key: 'j',
    action: { type: 'select-word-vertical', direction: 1 },
    acceptsCount: true,
    description: 'Move word selection down [count] line(s)',
  },
  {
    id: 'word:k',
    label: 'Word up',
    modes: ['word'],
    key: 'k',
    action: { type: 'select-word-vertical', direction: -1 },
    acceptsCount: true,
    description: 'Move word selection up [count] line(s)',
  },
  {
    id: 'word:w',
    label: 'Next word (alt)',
    modes: ['word'],
    key: 'w',
    action: { type: 'select-word', direction: 1 },
    acceptsCount: true,
    description: 'Select next [count] word(s) (same as l)',
  },
  {
    id: 'word:b',
    label: 'Previous word (alt)',
    modes: ['word'],
    key: 'b',
    action: { type: 'select-word', direction: -1 },
    acceptsCount: true,
    description: 'Select previous [count] word(s) (same as h)',
  },
  {
    id: 'word:enter',
    label: 'Translate word',
    modes: ['word'],
    key: 'Enter',
    action: { type: 'confirm-selection' },
    acceptsCount: false,
    description: 'Show translation for the selected word',
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
    modes: ['visual', 'normal'],
    key: 'V',
    shift: true,
    action: { type: 'select-line' },
    acceptsCount: false,
    description: 'Select the current visual line (Shift+V)',
  },
  {
    id: 'visual:G',
    label: 'Extend to bottom',
    modes: ['visual'],
    key: 'G',
    shift: true,
    action: { type: 'scroll-to', direction: 1 },
    acceptsCount: false,
    description: 'Extend selection to end of document',
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
