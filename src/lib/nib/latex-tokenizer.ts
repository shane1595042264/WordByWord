/**
 * LaTeX Tokenizer for .nib format
 *
 * Breaks LaTeX source into individual tokens for word-by-word display.
 * Each token is classified as either meaningful content or decorative structure.
 */

export interface LatexToken {
  text: string
  isDecorative: boolean
}

/** Operators that are decorative (structural, not content) */
const DECORATIVE_OPERATORS = new Set([
  '+', '-', '=', '<', '>', '/', '|', '!', ',', '.', ':', ';',
  '\\times', '\\cdot', '\\leq', '\\geq', '\\neq', '\\approx',
  '\\equiv', '\\pm', '\\mp', '\\div', '\\ast',
  '\\leftarrow', '\\rightarrow', '\\Leftarrow', '\\Rightarrow',
  '\\leftrightarrow', '\\Leftrightarrow',
  '\\subset', '\\supset', '\\subseteq', '\\supseteq',
  '\\in', '\\notin', '\\cap', '\\cup',
  '\\wedge', '\\vee', '\\neg',
  '\\ldots', '\\cdots', '\\dots',
])

/** Grouping symbols that are decorative */
const DECORATIVE_GROUPING = new Set(['(', ')', '[', ']', '{', '}'])

/** Sub/superscript markers that are decorative */
const DECORATIVE_SUBSUP = new Set(['_', '^'])

/** Spacing commands to skip entirely */
const SPACING_COMMANDS = new Set(['\\,', '\\;', '\\:', '\\!', '\\quad', '\\qquad'])

/** Commands that consume their brace argument as a single token (e.g. \text{hello} → one token) */
const WRAPPING_COMMANDS = new Set([
  '\\text', '\\textbf', '\\textit', '\\textrm', '\\texttt',
  '\\mathrm', '\\mathbf', '\\mathit', '\\mathbb', '\\mathcal', '\\mathfrak', '\\mathsf',
  '\\operatorname',
  '\\begin', '\\end',
  '\\label', '\\tag',
])

export function tokenizeLatex(latex: string): LatexToken[] {
  const tokens: LatexToken[] = []
  let i = 0

  while (i < latex.length) {
    const ch = latex[i]

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++
      continue
    }

    // Backslash command
    if (ch === '\\') {
      // "\ " (backslash-space) is a spacing command → skip
      if (i + 1 < latex.length && latex[i + 1] === ' ') {
        i += 2
        continue
      }

      // "~" is not backslash, handled below. Check for \command
      // Read the command name: \<letters> or \<single non-letter>
      let cmd = '\\'
      let j = i + 1
      if (j < latex.length && /[a-zA-Z]/.test(latex[j])) {
        while (j < latex.length && /[a-zA-Z]/.test(latex[j])) {
          cmd += latex[j]
          j++
        }
      } else if (j < latex.length) {
        cmd += latex[j]
        j++
      }

      // Check if it's a spacing command → skip
      if (SPACING_COMMANDS.has(cmd)) {
        i = j
        continue
      }

      // Check if it's a wrapping command that consumes {…}
      if (WRAPPING_COMMANDS.has(cmd) && j < latex.length && latex[j] === '{') {
        // Consume the entire {…} including nested braces
        let depth = 0
        let k = j
        while (k < latex.length) {
          if (latex[k] === '{') depth++
          else if (latex[k] === '}') {
            depth--
            if (depth === 0) { k++; break }
          }
          k++
        }
        const fullToken = latex.slice(i, k)
        tokens.push({ text: fullToken, isDecorative: false })
        i = k
        continue
      }

      // Check if it's a decorative operator
      if (DECORATIVE_OPERATORS.has(cmd)) {
        tokens.push({ text: cmd, isDecorative: true })
        i = j
        continue
      }

      // Otherwise it's a meaningful command token (e.g. \alpha, \frac, \sum, \log, \boldsymbol)
      tokens.push({ text: cmd, isDecorative: false })
      i = j
      continue
    }

    // Tilde is a non-breaking space → skip
    if (ch === '~') {
      i++
      continue
    }

    // Decorative grouping
    if (DECORATIVE_GROUPING.has(ch)) {
      tokens.push({ text: ch, isDecorative: true })
      i++
      continue
    }

    // Sub/superscript
    if (DECORATIVE_SUBSUP.has(ch)) {
      tokens.push({ text: ch, isDecorative: true })
      i++
      continue
    }

    // Decorative single-char operators
    if (DECORATIVE_OPERATORS.has(ch)) {
      tokens.push({ text: ch, isDecorative: true })
      i++
      continue
    }

    // Single letter or digit → meaningful token
    tokens.push({ text: ch, isDecorative: false })
    i++
  }

  return tokens
}
