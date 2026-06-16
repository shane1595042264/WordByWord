const MAX_CALLBACK_LENGTH = 2048

export function sanitizeCallbackUrl(value: string | null | undefined): string {
  if (typeof value !== 'string') return '/'
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_CALLBACK_LENGTH) return '/'
  if (trimmed[0] !== '/') return '/'
  const second = trimmed[1]
  if (second === '/' || second === '\\') return '/'
  const lower = trimmed.slice(0, 6).toLowerCase()
  if (lower.startsWith('/%2f') || lower.startsWith('/%5c')) return '/'
  return trimmed
}
