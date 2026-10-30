import type { NibWord } from '@/lib/nib'

/**
 * Request-size caps of nibble-api's reader AI endpoints (src/routes/ai.ts zod
 * schemas). Anything longer is rejected with a 400 VALIDATION_ERROR, and since
 * the text comes straight from the book, a retry can never succeed (KAN-374).
 */
export const MAX_SENTENCE_CHARS = 2000
export const MAX_PARAGRAPH_CONTEXT_CHARS = 5000

/**
 * The longest contiguous run of `items`, joined with single spaces, that
 * contains `items[index]` and fits in `maxChars`. Grows outward one neighbour
 * at a time, alternating sides, so the target stays near the middle; a side
 * stops growing at the first neighbour that won't fit. Input that already fits
 * comes back unchanged. An oversized target item is cut to `maxChars`.
 */
export function windowAround(items: string[], index: number, maxChars: number): string {
  if (items.length === 0) return ''
  const full = items.join(' ')
  if (full.length <= maxChars) return full

  const target = Math.min(Math.max(index, 0), items.length - 1)
  const center = items[target].slice(0, maxChars)
  let lo = target
  let hi = target
  let length = center.length
  let leftOpen = true
  let rightOpen = true
  while (leftOpen || rightOpen) {
    if (rightOpen) {
      const next = hi + 1 < items.length ? items[hi + 1].length + 1 : Infinity
      if (length + next <= maxChars) { hi++; length += next } else rightOpen = false
    }
    if (leftOpen) {
      const next = lo > 0 ? items[lo - 1].length + 1 : Infinity
      if (length + next <= maxChars) { lo--; length += next } else leftOpen = false
    }
  }
  return [...items.slice(lo, target), center, ...items.slice(target + 1, hi + 1)].join(' ')
}

/**
 * The sentence (<= MAX_SENTENCE_CHARS, around the word) and paragraph context
 * (<= MAX_PARAGRAPH_CONTEXT_CHARS, around that sentence) to send with an AI
 * lookup for `word`. Short paragraphs come back as the full text, unchanged.
 */
export function translationContext(word: NibWord): { sentence: string; paragraph: string } {
  const words = word.sentence.words
  const sentence = windowAround(words.map(w => w.text), words.indexOf(word), MAX_SENTENCE_CHARS)
  const sentences = word.paragraph?.sentences ?? []
  const sentenceIndex = sentences.indexOf(word.sentence)
  if (sentenceIndex < 0) return { sentence, paragraph: sentence }
  const texts = sentences.map((s, i) => (i === sentenceIndex ? sentence : s.text))
  return { sentence, paragraph: windowAround(texts, sentenceIndex, MAX_PARAGRAPH_CONTEXT_CHARS) }
}
