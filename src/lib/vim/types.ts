/**
 * Vim-style keybinding system for BitByBit / WordByWord reader.
 *
 * Architecture:
 *   VimMode  — "normal" | "select"
 *   VimRule  — a single keybinding entry in the rulebook
 *   Rulebook — the full table of rules, easily extensible
 *
 * The engine processes keystrokes, maintains mode state, and dispatches
 * actions. A numeric prefix buffer (e.g. "23") multiplies motions.
 *
 * Inspired by Vim but adapted for a reading app:
 *   Normal mode  — navigation only (j/k/d/u/gg/G)
 *   Select mode  — word/sentence/line selection (w/b/e/s/V)
 *
 * To add a new binding, just add a VimRule to the rulebook. No other
 * code changes needed.
 */

export type VimMode = 'normal' | 'select'

/** Sub-mode within select mode: word-level or sentence-level navigation */
export type VimSelectSubMode = 'word' | 'sentence'

/** What kind of action the rule triggers */
export type VimActionType =
  | 'scroll'              // scroll the text pane by N lines / half-pages
  | 'scroll-to'           // scroll to top / bottom
  | 'cursor-line'         // move the cursor line up/down (like j/k in a text editor)
  | 'select-word'         // select next/prev word (h/l in word sub-mode)
  | 'select-word-vertical' // move word cursor to line above/below (j/k in word sub-mode)
  | 'select-sentence'     // select next/prev sentence (h/l in sentence sub-mode)
  | 'select-sentence-vertical' // move sentence cursor to line above/below (j/k in sentence sub-mode)
  | 'select-line'         // select current visual line (like V)
  | 'select-horizontal'   // context-aware h/l: moves word or sentence based on sub-mode
  | 'select-vertical'     // context-aware j/k: moves word or sentence vertically based on sub-mode
  | 'enter-word-submode'  // switch to word sub-mode (w key)
  | 'enter-sentence-submode' // switch to sentence sub-mode (s key)
  | 'confirm-selection'   // confirm current selection (show info panel)
  | 'mode-change'         // switch vim mode
  | 'escape'              // exit select mode / clear selection
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
 *
 * To add a new keybinding, just push a VimRule into the rulebook array.
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
