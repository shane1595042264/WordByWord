import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { KeymapOverrides } from '@/lib/services/settings-service'

// KAN-382: the global and vim keydown handlers are siblings on window, so a key
// bound in both scopes runs both actions. The editor only checked each scope
// against itself — recording 'j' for Next Page saved silently and every j press
// then moved the vim cursor AND changed section.
const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }))

import { KeymapSettings } from '../keymap-settings'

function renderKeymap(overrides: KeymapOverrides = {}) {
  const onChange = vi.fn()
  render(<KeymapSettings overrides={overrides} onChange={onChange} />)
  return onChange
}

function record(rowLabel: string, init: KeyboardEventInit) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Remap ${rowLabel.replace(/[()+]/g, '\\$&')}, currently`) }))
  fireEvent.keyDown(window, init)
}

describe('KeymapSettings — global vs vim conflicts', () => {
  beforeEach(() => toastError.mockReset())

  it('rejects a bare vim motion key on a global shortcut', () => {
    const onChange = renderKeymap()
    record('Next Page', { key: 'j' })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toBe('"j" is already used by "Word down"')
  })

  it('rejects a vim Ctrl combo on a global shortcut', () => {
    const onChange = renderKeymap()
    record('PDF View', { key: 'e', ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toContain('Scroll down (Ctrl+E)')
  })

  it('rejects a Shift+letter vim rule on a global shortcut', () => {
    const onChange = renderKeymap()
    record('Next Page', { key: 'G', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('rejects Ctrl+C, which the vim engine reserves for yank', () => {
    const onChange = renderKeymap()
    record('Next Page', { key: 'c', ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toContain('Yank (copy)')
  })

  it('rejects a vim-mode-only key even outside normal mode', () => {
    // 'S' is a sentence-mode-only rule; globals fire in every mode.
    const onChange = renderKeymap()
    record('Next Page', { key: 'S', shiftKey: true })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still saves a global key no vim rule uses', () => {
    const onChange = renderKeymap()
    record('Next Page', { key: 'n' })
    expect(toastError).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ 'next-page': 'n' })
  })

  it('allows a global onto a vim key once that vim rule is remapped away', () => {
    const onChange = renderKeymap({ 'normal:j': 'n', 'sentence:j': 'n', 'visual:j': 'n' })
    record('Next Page', { key: 'j' })
    expect(toastError).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ 'normal:j': 'n', 'sentence:j': 'n', 'visual:j': 'n', 'next-page': 'j' })
  })

  it('rejects remapping a vim rule onto a key a global already owns', () => {
    const onChange = renderKeymap({ 'next-page': 'n' })
    record('Word down', { key: 'n' })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toBe('"n" is already used by "Next Page"')
  })

  it('still saves a vim combo no global uses', () => {
    const onChange = renderKeymap()
    record('Word down', { key: 'x' })
    expect(onChange).toHaveBeenCalledWith({ 'normal:j': 'x' })
  })
})
