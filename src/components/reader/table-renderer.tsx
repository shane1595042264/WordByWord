'use client'

/**
 * Detects and renders table-like content from extracted text.
 *
 * Supports:
 *  - Tab-separated tables
 *  - Pipe-delimited tables (markdown style: | col1 | col2 |)
 *  - Space-aligned columns (heuristic: 3+ spaces between tokens)
 *
 * Tables are rendered as styled HTML tables.
 */

interface TableData {
  headers: string[]
  rows: string[][]
  hasHeader: boolean
}

/** Check if a block of text looks like a table */
export function isTableBlock(text: string): boolean {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return false

  // Pipe-delimited (markdown tables)
  if (lines.every(l => l.includes('|') && l.trim().startsWith('|'))) return true

  // Tab-delimited
  const tabLines = lines.filter(l => l.includes('\t'))
  if (tabLines.length >= lines.length * 0.7 && tabLines.length >= 2) return true

  // Space-aligned columns (3+ consecutive spaces as delimiter)
  const spaceAligned = lines.filter(l => /\S {3,}\S/.test(l))
  if (spaceAligned.length >= lines.length * 0.7 && spaceAligned.length >= 3) return true

  return false
}

/** Parse table text into structured data */
export function parseTable(text: string): TableData | null {
  const lines = text.trim().split('\n').filter(l => l.trim())
  if (lines.length < 2) return null

  let rows: string[][] = []

  // Try pipe-delimited first
  if (lines.every(l => l.includes('|'))) {
    rows = lines
      .filter(l => !/^[\s|:-]+$/.test(l)) // skip separator lines like |---|---|
      .map(l =>
        l.split('|')
          .map(cell => cell.trim())
          .filter((_, i, arr) => i > 0 && i < arr.length) // remove empty first/last from | col |
      )
  }
  // Try tab-delimited
  else if (lines.some(l => l.includes('\t'))) {
    rows = lines.map(l => l.split('\t').map(cell => cell.trim()))
  }
  // Try space-aligned
  else {
    // Find column boundaries by looking at spaces
    rows = lines.map(l => l.split(/\s{3,}/).map(cell => cell.trim()).filter(Boolean))
  }

  if (rows.length < 2) return null

  // Check if first row looks like a header (different formatting or all caps)
  const firstRow = rows[0]
  const hasHeader = firstRow.every(cell =>
    cell === cell.toUpperCase() ||
    /^[A-Z]/.test(cell) ||
    /^[-_\s]*$/.test(cell) === false
  )

  return {
    headers: hasHeader ? rows[0] : [],
    rows: hasHeader ? rows.slice(1) : rows,
    hasHeader,
  }
}

/** Render a table from parsed data */
export function TableView({ data }: { data: TableData }) {
  return (
    <div className="my-4 overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-sm">
        {data.hasHeader && data.headers.length > 0 && (
          <thead>
            <tr className="border-b bg-muted/30">
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  className="px-4 py-2 text-left font-semibold text-foreground/80"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {data.rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? 'bg-muted/10' : ''}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-4 py-2 text-foreground/70 border-t border-border/20">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Combined component: detect + render table from text */
export function TableRenderer({ text }: { text: string }) {
  const data = parseTable(text)
  if (!data) {
    return <p className="leading-relaxed text-base whitespace-pre-wrap">{text}</p>
  }
  return <TableView data={data} />
}
