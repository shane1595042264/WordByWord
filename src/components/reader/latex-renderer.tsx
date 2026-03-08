'use client'

import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/**
 * Detects and renders LaTeX math expressions within text.
 * Supports:
 *   - Inline math: $...$ or \(...\)
 *   - Display math: $$...$$ or \[...\]
 *
 * Returns an array of React elements (text spans + rendered math).
 */

interface LatexSegment {
  type: 'text' | 'inline-math' | 'display-math'
  content: string
}

// Regex patterns for LaTeX delimiters
// Order matters: check display math ($$) before inline ($)
const LATEX_PATTERNS = [
  { regex: /\$\$([\s\S]+?)\$\$/g, type: 'display-math' as const },
  { regex: /\\\[([\s\S]+?)\\\]/g, type: 'display-math' as const },
  { regex: /\$([^$\n]+?)\$/g, type: 'inline-math' as const },
  { regex: /\\\((.+?)\\\)/g, type: 'inline-math' as const },
]

/** Check if a string contains any LaTeX math expressions */
export function containsLatex(text: string): boolean {
  return LATEX_PATTERNS.some(({ regex }) => {
    const r = new RegExp(regex.source, regex.flags)
    return r.test(text)
  })
}

/** Parse text into segments of plain text and LaTeX math */
export function parseLatex(text: string): LatexSegment[] {
  // Collect all matches with their positions
  type Match = { start: number; end: number; content: string; type: 'inline-math' | 'display-math' }
  const matches: Match[] = []

  for (const { regex, type } of LATEX_PATTERNS) {
    const r = new RegExp(regex.source, regex.flags)
    let m: RegExpExecArray | null
    while ((m = r.exec(text)) !== null) {
      // Check this match doesn't overlap with an existing one
      const start = m.index
      const end = m.index + m[0].length
      const overlaps = matches.some(
        existing => start < existing.end && end > existing.start
      )
      if (!overlaps) {
        matches.push({ start, end, content: m[1], type })
      }
    }
  }

  if (matches.length === 0) {
    return [{ type: 'text', content: text }]
  }

  // Sort by position
  matches.sort((a, b) => a.start - b.start)

  const segments: LatexSegment[] = []
  let cursor = 0

  for (const match of matches) {
    if (match.start > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, match.start) })
    }
    segments.push({ type: match.type, content: match.content })
    cursor = match.end
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) })
  }

  return segments
}

/** Render a single LaTeX expression to HTML using KaTeX */
function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      errorColor: '#ef4444',
      trust: true,
    })
  } catch {
    return latex
  }
}

/** Component that renders text with inline LaTeX math */
export function LatexText({ text, className }: { text: string; className?: string }) {
  const segments = useMemo(() => parseLatex(text), [text])

  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <span key={i}>{seg.content}</span>
        }

        const isDisplay = seg.type === 'display-math'
        const html = renderKatex(seg.content, isDisplay)

        if (isDisplay) {
          return (
            <span
              key={i}
              className="block my-2 text-center overflow-x-auto"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        }

        return (
          <span
            key={i}
            className="inline-block align-middle"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )
      })}
    </span>
  )
}
