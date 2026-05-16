import { describe, it, expect } from 'vitest'
import { tokenizeLatex, LatexToken } from '../latex-tokenizer'

/** Helper: extract just the text values from tokens */
function texts(tokens: LatexToken[]): string[] {
  return tokens.map(t => t.text)
}

/** Helper: extract tokens that are NOT decorative */
function meaningful(tokens: LatexToken[]): string[] {
  return tokens.filter(t => !t.isDecorative).map(t => t.text)
}

describe('tokenizeLatex', () => {
  it('1. simple variables: O(mn)', () => {
    const tokens = tokenizeLatex('O(mn)')
    expect(texts(tokens)).toEqual(['O', '(', 'm', 'n', ')'])
    expect(tokens[0].isDecorative).toBe(false) // O
    expect(tokens[1].isDecorative).toBe(true)  // (
    expect(tokens[2].isDecorative).toBe(false) // m
    expect(tokens[3].isDecorative).toBe(false) // n
    expect(tokens[4].isDecorative).toBe(true)  // )
  })

  it('2. Greek letters: \\alpha + \\beta', () => {
    const tokens = tokenizeLatex('\\alpha + \\beta')
    expect(texts(tokens)).toEqual(['\\alpha', '+', '\\beta'])
    expect(tokens[0].isDecorative).toBe(false)
    expect(tokens[1].isDecorative).toBe(true)
    expect(tokens[2].isDecorative).toBe(false)
  })

  it('3. fractions: \\frac{a}{b}', () => {
    const tokens = tokenizeLatex('\\frac{a}{b}')
    expect(texts(tokens)).toEqual(['\\frac', '{', 'a', '}', '{', 'b', '}'])
    expect(tokens[0].isDecorative).toBe(false) // \frac
    expect(tokens[1].isDecorative).toBe(true)  // {
    expect(tokens[2].isDecorative).toBe(false) // a
  })

  it('4. subscripts: x_1', () => {
    const tokens = tokenizeLatex('x_1')
    expect(texts(tokens)).toEqual(['x', '_', '1'])
    expect(tokens[1].isDecorative).toBe(true) // _
  })

  it('5. summation: \\sum_{i=0}^{n}', () => {
    const tokens = tokenizeLatex('\\sum_{i=0}^{n}')
    expect(texts(tokens)).toEqual(['\\sum', '_', '{', 'i', '=', '0', '}', '^', '{', 'n', '}'])
    expect(tokens[0].isDecorative).toBe(false) // \sum
    expect(tokens[1].isDecorative).toBe(true)  // _
    expect(tokens[3].isDecorative).toBe(false) // i
    expect(tokens[4].isDecorative).toBe(true)  // =
  })

  it('6. \\text{for all} → single token', () => {
    const tokens = tokenizeLatex('\\text{for all}')
    expect(texts(tokens)).toEqual(['\\text{for all}'])
    expect(tokens[0].isDecorative).toBe(false)
  })

  it('7. named functions: \\log x', () => {
    const tokens = tokenizeLatex('\\log x')
    expect(texts(tokens)).toEqual(['\\log', 'x'])
    expect(tokens[0].isDecorative).toBe(false)
    expect(tokens[1].isDecorative).toBe(false)
  })

  it('8. spacing skipped: a \\, b', () => {
    const tokens = tokenizeLatex('a \\, b')
    expect(texts(tokens)).toEqual(['a', 'b'])
  })

  it('8b. other spacing commands skipped', () => {
    expect(texts(tokenizeLatex('a \\; b'))).toEqual(['a', 'b'])
    expect(texts(tokenizeLatex('a \\quad b'))).toEqual(['a', 'b'])
    expect(texts(tokenizeLatex('a ~ b'))).toEqual(['a', 'b'])
    expect(texts(tokenizeLatex('a \\ b'))).toEqual(['a', 'b'])
  })

  it('9. \\boldsymbol{O} → command + braces + content', () => {
    const tokens = tokenizeLatex('\\boldsymbol{O}')
    expect(texts(tokens)).toEqual(['\\boldsymbol', '{', 'O', '}'])
    expect(tokens[0].isDecorative).toBe(false)
  })

  it('10. \\begin{align} → single token', () => {
    const tokens = tokenizeLatex('\\begin{align}')
    expect(texts(tokens)).toEqual(['\\begin{align}'])
    expect(tokens[0].isDecorative).toBe(false)
  })

  it('\\end{equation} → single token', () => {
    const tokens = tokenizeLatex('\\end{equation}')
    expect(texts(tokens)).toEqual(['\\end{equation}'])
  })

  it('\\mathrm{d} → single token', () => {
    const tokens = tokenizeLatex('\\mathrm{d}')
    expect(texts(tokens)).toEqual(['\\mathrm{d}'])
    expect(tokens[0].isDecorative).toBe(false)
  })

  it('\\operatorname{argmax} → single token', () => {
    const tokens = tokenizeLatex('\\operatorname{argmax}')
    expect(texts(tokens)).toEqual(['\\operatorname{argmax}'])
  })

  it('decorative operators: \\times, \\cdot, \\leq, \\geq, \\neq', () => {
    for (const op of ['\\times', '\\cdot', '\\leq', '\\geq', '\\neq']) {
      const tokens = tokenizeLatex(op)
      expect(tokens).toHaveLength(1)
      expect(tokens[0].isDecorative).toBe(true)
    }
  })

  it('handles empty string', () => {
    expect(tokenizeLatex('')).toEqual([])
  })

  it('handles complex expression: \\frac{\\partial f}{\\partial x}', () => {
    const tokens = tokenizeLatex('\\frac{\\partial f}{\\partial x}')
    expect(texts(tokens)).toEqual([
      '\\frac', '{', '\\partial', 'f', '}', '{', '\\partial', 'x', '}',
    ])
  })

  it('superscript: x^2', () => {
    const tokens = tokenizeLatex('x^2')
    expect(texts(tokens)).toEqual(['x', '^', '2'])
    expect(tokens[1].isDecorative).toBe(true)
  })
})
