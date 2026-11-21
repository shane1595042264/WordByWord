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

/**
 * nibble-api's bound on a vocab row's contextSentence (routes/vocabulary.ts
 * VOCAB_CONTEXT_SENTENCE_MAX). /sync drops a longer row into failedEntities, so
 * it would re-queue and fail on every sync, never reaching the server (KAN-377).
 */
export const MAX_VOCAB_CONTEXT_CHARS = 2000

/**
 * The context sentence to store with a saved vocab entry for `word`. A
 * sentence within the server bound is kept byte-identical, so rows saved
 * before the cap still match; a longer one is windowed around the word.
 */
export function vocabContextSentence(word: NibWord): string {
  if (word.sentence.text.length <= MAX_VOCAB_CONTEXT_CHARS) return word.sentence.text
  const words = word.sentence.words
  return windowAround(words.map(w => w.text), words.indexOf(word), MAX_VOCAB_CONTEXT_CHARS)
}

/**
 * Cap an already-stored contextSentence for the sync push, windowed around the
 * first occurrence of `word` (or the start if it isn't found). Drains rows
 * saved before vocabContextSentence existed. Text within the bound is unchanged.
 */
export function capVocabContext(text: string, word: string): string {
  if (text.length <= MAX_VOCAB_CONTEXT_CHARS) return text
  const tokens = text.split(' ')
  const at = text.indexOf(word)
  const index = at < 0 ? 0 : text.slice(0, at).split(' ').length - 1
  return windowAround(tokens, index, MAX_VOCAB_CONTEXT_CHARS)
}

/**
 * nibble-api's caps on /ai/explain-translation `word` and /ai/explain-content
 * `content`. Every token of a math run carries the whole equation as
 * latexSource, and a [Table]/[Code] word carries the whole block, so sending
 * those uncut 400'd on every long equation or block (KAN-415).
 */
export const MAX_EXPLAIN_WORD_CHARS = 200
export const MAX_EXPLAIN_CONTENT_CHARS = 10000

/**
 * The `word` to send to /ai/explain-translation. A math token sends its whole
 * equation while it fits; a longer one sends the tokens of that equation
 * around the clicked one. Plain words send their text, unchanged.
 */
export function explainTranslationWord(word: NibWord): string {
  const latex = word.latexSource
  if (!latex) return word.text
  if (latex.length <= MAX_EXPLAIN_WORD_CHARS) return latex
  const words = word.sentence.words
  const at = words.indexOf(word)
  if (at < 0) return word.text.slice(0, MAX_EXPLAIN_WORD_CHARS)
  let lo = at
  let hi = at
  while (lo > 0 && words[lo - 1].latexSource === latex) lo--
  while (hi + 1 < words.length && words[hi + 1].latexSource === latex) hi++
  return windowAround(words.slice(lo, hi + 1).map(w => w.text), at - lo, MAX_EXPLAIN_WORD_CHARS)
}

const TRUNCATED_MARK = '\n… (truncated)'

/**
 * Cap a table/code block's raw markdown for /ai/explain-content. Keeps the
 * start (a table's header rows), cut at a line break so no row is split, and
 * marks the cut. Content within the cap is unchanged.
 */
export function capExplainContent(content: string): string {
  if (content.length <= MAX_EXPLAIN_CONTENT_CHARS) return content
  const head = content.slice(0, MAX_EXPLAIN_CONTENT_CHARS - TRUNCATED_MARK.length)
  const lineEnd = head.lastIndexOf('\n')
  return (lineEnd > 0 ? head.slice(0, lineEnd) : head) + TRUNCATED_MARK
}
