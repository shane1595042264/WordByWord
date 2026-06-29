import { describe, it, expect } from 'vitest'
import { isChunkLoadError } from '../lazy-import-error'

describe('isChunkLoadError', () => {
  it('matches the webpack/Next ChunkLoadError by name', () => {
    const err = new Error('whatever')
    err.name = 'ChunkLoadError'
    expect(isChunkLoadError(err)).toBe(true)
  })

  it('matches the "Loading chunk N failed" message', () => {
    expect(isChunkLoadError(new Error('Loading chunk 482 failed.'))).toBe(true)
  })

  it('matches the "Loading CSS chunk failed" message', () => {
    expect(isChunkLoadError(new Error('Loading CSS chunk app-layout failed.'))).toBe(true)
  })

  it('matches the native "Failed to fetch dynamically imported module" message', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/_next/abc.js')),
    ).toBe(true)
  })

  it('matches the Firefox "error loading dynamically imported module" message', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })

  it('matches the html-instead-of-js MIME error', () => {
    expect(
      isChunkLoadError(new Error("Expected a JavaScript module but the server responded with 'text/html' is not a valid JavaScript MIME type.")),
    ).toBe(true)
  })

  it('does NOT match an unrelated runtime error', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('does NOT match an AbortError', () => {
    const err = new Error('aborted')
    err.name = 'AbortError'
    expect(isChunkLoadError(err)).toBe(false)
  })

  it('handles null/undefined/non-error values safely', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('Loading chunk 1 failed')).toBe(false)
    expect(isChunkLoadError({})).toBe(false)
  })
})
