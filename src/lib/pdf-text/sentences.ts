/**
 * Sentence grouping over an ordered word list.
 *
 * Text view gets its sentences from NibParser (src/lib/nib/parser.ts,
 * `splitSentences`), which works on a joined string with a regex. The PDF text
 * layer has no joined string — only word spans in DOM order — so this module
 * re-expresses the same rule word-by-word: a boundary falls AFTER a word that
 * ends a sentence and BEFORE a word that can start one. Keeping the rule
 * identical means the sentence `s` mode highlights the same stretch of text
 * whichever pane the reader is in.
 */

/** Half-open range of flat word indices: words[start..end) form one sentence. */
export interface SentenceRange {
  start: number
  /** Exclusive. */
  end: number
}

/**
 * Words that end in a period without ending a sentence. Case-sensitive, like
 * the parser's lookbehind: "no." at the end of "The answer is no." must still
 * split, while "No. 5" must not.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr',
  'vs', 'etc', 'Inc', 'Ltd', 'Corp', 'St', 'Ave',
  'approx', 'ca', 'cf', 'e.g', 'i.e', 'al',
  'Fig', 'Eq', 'No', 'pp',
])

/** Closing quotes / brackets that may trail the terminal punctuation: `word."` or `(see above).` */
const TRAILING_CLOSERS = /["'”’)\]}»]+$/
/** Opening quotes / brackets that may precede a sentence's first letter: `"Hello` or `(The` */
const LEADING_OPENERS = /^["'“‘(\[{«]+/
const TERMINAL_PUNCTUATION = /[.!?]$/

/**
 * True when `ch` is an uppercase letter in any script — `[A-Z]` would miss
 * "Élan" and the project's target (ES2017) predates `\p{Lu}`. A character
 * with no case (digits, CJK) has identical upper/lower forms and so is not a
 * letter for this purpose.
 */
function isUpperLetter(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase() && ch === ch.toUpperCase()
}

/** Does this word, read on its own, close a sentence? */
function endsSentence(word: string): boolean {
  const stripped = word.replace(TRAILING_CLOSERS, '')
  if (!TERMINAL_PUNCTUATION.test(stripped)) return false
  // Drop the terminal mark and any opening quote the word began with, then
  // ask whether what is left is an abbreviation ("Dr." → "Dr", "(e.g." → "e.g").
  const core = stripped.slice(0, -1).replace(LEADING_OPENERS, '')
  return !ABBREVIATIONS.has(core)
}

/** Can this word open a sentence? Uppercase letter, digit, or an opening quote/bracket. */
function startsSentence(word: string): boolean {
  if (word.length === 0) return false
  if (LEADING_OPENERS.test(word)) return true
  const first = word[0]
  return /[0-9]/.test(first) || isUpperLetter(first)
}

/**
 * Group an ordered word list into sentences. The last range always runs to
 * the end of the list (a trailing fragment without terminal punctuation is
 * still a sentence as far as the cursor is concerned). Empty input → [].
 */
export function splitWordsIntoSentences(words: readonly string[]): SentenceRange[] {
  const ranges: SentenceRange[] = []
  if (words.length === 0) return ranges

  let start = 0
  for (let i = 0; i < words.length - 1; i++) {
    if (endsSentence(words[i]) && startsSentence(words[i + 1])) {
      ranges.push({ start, end: i + 1 })
      start = i + 1
    }
  }
  ranges.push({ start, end: words.length })
  return ranges
}

/**
 * Index of the range containing `wordIndex`, or -1. Ranges from
 * `splitWordsIntoSentences` are sorted and contiguous, so this is a binary
 * search — the cursor calls it on every motion.
 */
export function findSentenceIndex(ranges: readonly SentenceRange[], wordIndex: number): number {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]
    if (wordIndex < r.start) hi = mid - 1
    else if (wordIndex >= r.end) lo = mid + 1
    else return mid
  }
  return -1
}
