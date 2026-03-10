/**
 * Vim-style keybinding system for BitByBit / WordByWord reader.
 *
 * Architecture:
 *   VimMode  — "normal" | "sentence" | "visual"
 *   VimRule  — a single keybinding entry in the rulebook
 *   Rulebook — the full table of rules, easily extensible
 *
 * The engine processes keystrokes, maintains mode state, and dispatches
 * actions. A numeric prefix buffer (e.g. "23") multiplies motions.
 *
 * Modes:
 *   Normal mode   — word-level cursor (h/l next/prev word, j/k word vertical,
 *                    d/u half-page, gg/G, Enter to translate)
 *   Sentence mode — sentence-level selection + translation
 *   Visual mode   — pure Vim visual selection (character/chunk-level, no translation)
 *
 * From normal: s → sentence mode, v → visual mode
 */

export type VimMode = 'normal' | 'sentence' | 'visual'

/** What kind of action the rule triggers */
export type VimActionType =
  | 'scroll'              // scroll the text pane by N lines / half-pages
  | 'scroll-to'           // scroll to top / bottom
  | 'select-word'         // select next/prev word (h/l in normal mode)
  | 'select-word-vertical' // move word cursor to line above/below (j/k in normal mode)
  | 'select-sentence'     // select next/prev sentence (h/l in sentence mode)
  | 'select-sentence-vertical' // move sentence cursor to line above/below (j/k in sentence mode)
  | 'select-line'         // select current visual line (V in visual mode)
  | 'select-to-end'       // extend selection from current to last word (G in visual mode)
  | 'select-to-start'     // extend selection from current to first word (gg in visual mode)
  | 'confirm-selection'   // confirm current selection (Enter — translate in normal/sentence mode)
  | 'yank'                // copy (yank) current selection to clipboard
  | 'mode-change'         // switch vim mode
  | 'escape'              // exit to normal mode / clear selection
  | 'custom'              // arbitrary callback (for future extensibility)

export interface VimAction {
  type: VimActionType
  /** Direction / magnitude: positive = forward/down, negative = backward/up */
  direction?: number
  /** How many "units" per keypress (before count multiplier) */
  magnitude?: number
  /** Target mode for mode-change actions */
  targetMode?: VimMode
  /** Custom callback for 'custom' actions */
  handler?: (ctx: VimContext) => void
}

/** Context passed to action handlers */
export interface VimContext {
  /** The text scroll container element */
  scrollEl: HTMLElement | null
  /** Current line height in pixels (for line-based scrolling) */
  lineHeight: number
  /** Repeat count from numeric prefix (default 1) */
  count: number
  /** Current mode */
  mode: VimMode
  /** Callback to change mode */
  setMode: (mode: VimMode) => void
  /** Callback to select a word by visual position */
  selectWordAtIndex: (delta: number) => void
  /** Callback to select a sentence by delta */
  selectSentenceAtDelta: (delta: number) => void
  /** Callback to select the current visual line */
  selectCurrentLine: () => void
  /** Callback to clear selection */
  clearSelection: () => void
}

/**
 * A single rule in the Vim keybinding rulebook.
 */
export interface VimRule {
  /** Unique id for the rule */
  id: string
  /** Human-readable label */
  label: string
  /** Which mode(s) this rule applies in */
  modes: VimMode[]
  /** The key to match (e.g. 'j', 'k', 'V', 'Escape') */
  key: string
  /** Whether Shift must be held (for distinguishing 'v' vs 'V') */
  shift?: boolean
  /** The action to dispatch */
  action: VimAction
  /** Whether this binding accepts a numeric count prefix */
  acceptsCount?: boolean
  /** Description for the help overlay / rulebook display */
  description: string
}
