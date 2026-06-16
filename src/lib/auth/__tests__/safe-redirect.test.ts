import { describe, it, expect } from 'vitest'
import { sanitizeCallbackUrl } from '../safe-redirect'

describe('sanitizeCallbackUrl', () => {
  it('passes through safe same-origin relative paths', () => {
    expect(sanitizeCallbackUrl('/')).toBe('/')
    expect(sanitizeCallbackUrl('/books')).toBe('/books')
    expect(sanitizeCallbackUrl('/books/123?page=2#frag')).toBe('/books/123?page=2#frag')
  })

  it('rejects absolute http/https URLs', () => {
    expect(sanitizeCallbackUrl('https://evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('http://evil.example/path')).toBe('/')
    expect(sanitizeCallbackUrl('https://nibbook.com/books')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeCallbackUrl('//evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('//evil.example/path')).toBe('/')
  })

  it('rejects backslash-relative URLs (browsers normalize \\\\ to //)', () => {
    expect(sanitizeCallbackUrl('/\\evil.example')).toBe('/')
    expect(sanitizeCallbackUrl('\\\\evil.example')).toBe('/')
  })

  it('rejects URL-encoded protocol-relative variants', () => {
    expect(sanitizeCallbackUrl('/%2fevil.example')).toBe('/')
    expect(sanitizeCallbackUrl('/%2Fevil.example')).toBe('/')
    expect(sanitizeCallbackUrl('/%5cevil.example')).toBe('/')
    expect(sanitizeCallbackUrl('/%5Cevil.example')).toBe('/')
  })

  it('rejects dangerous schemes', () => {
    expect(sanitizeCallbackUrl('javascript:alert(1)')).toBe('/')
    expect(sanitizeCallbackUrl('data:text/html,<script>alert(1)</script>')).toBe('/')
    expect(sanitizeCallbackUrl('vbscript:msgbox(1)')).toBe('/')
  })

  it('rejects bare relative paths that do not start with /', () => {
    expect(sanitizeCallbackUrl('books')).toBe('/')
    expect(sanitizeCallbackUrl('./books')).toBe('/')
    expect(sanitizeCallbackUrl('../admin')).toBe('/')
  })

  it('handles null, undefined, empty, and whitespace-only', () => {
    expect(sanitizeCallbackUrl(null)).toBe('/')
    expect(sanitizeCallbackUrl(undefined)).toBe('/')
    expect(sanitizeCallbackUrl('')).toBe('/')
    expect(sanitizeCallbackUrl('   ')).toBe('/')
  })

  it('rejects payloads exceeding the length cap', () => {
    const huge = '/' + 'a'.repeat(2048)
    expect(sanitizeCallbackUrl(huge)).toBe('/')
  })

  it('trims surrounding whitespace before evaluating', () => {
    expect(sanitizeCallbackUrl('  /books  ')).toBe('/books')
    expect(sanitizeCallbackUrl('\t//evil.example')).toBe('/')
  })
})
