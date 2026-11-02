/**
 * Turn an average progress (0-100) into the whole-number percentage shown in the
 * UI. Plain rounding would show "100%" for any average in [99.5, 100), which on a
 * 200+ section book hides a whole unstarted section — so the value is capped at
 * 99 until every section is read (KAN-381).
 */
export function toProgressPercentage(average: number, read: number, total: number): number {
  if (total === 0) return 0
  const rounded = Math.round(average)
  return read < total ? Math.min(rounded, 99) : rounded
}
