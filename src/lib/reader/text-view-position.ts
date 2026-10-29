/**
 * Continue Reading position for the text view (KAN-372).
 *
 * The vim cursor only moves on vim motions and word clicks, so a reader who
 * scrolls with a mouse wheel, trackpad or scrollbar leaves it behind at the top
 * of the section. Saving the cursor alone resumed those readers at word 0.
 *
 * Rule: while the cursor word is still on screen it is the reader's spot and
 * wins (exact word restore, cursor-line progress). Once a scroll has carried it
 * out of the viewport, the viewport wins. Every vim motion and click scrolls
 * the cursor into view and a manual scroll moves it out, so whichever happened
 * last decides the position.
 */

export interface TextViewSnapshot {
  /** Position the cursor path computed: cursor-line progress (0-100) and cursor word. */
  cursorProgress: number
  cursorWordIndex: number | null
  cursorInView: boolean
  /** Word at the viewport's reading position, or null when no word is on screen. */
  viewportWordIndex: number | null
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export interface SavedTextPosition {
  progress: number
  wordIndex: number | null
}

export function resolveTextViewPosition(s: TextViewSnapshot): SavedTextPosition {
  if (s.cursorInView) {
    return { progress: s.cursorProgress, wordIndex: s.cursorWordIndex }
  }
  const maxScroll = s.scrollHeight - s.clientHeight
  const progress = maxScroll <= 0 ? 100 : Math.min(100, Math.max(0, Math.round((s.scrollTop / maxScroll) * 100)))
  return { progress, wordIndex: s.viewportWordIndex }
}
