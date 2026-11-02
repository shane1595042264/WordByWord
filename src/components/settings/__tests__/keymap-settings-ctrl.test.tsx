import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { KeymapOverrides } from '@/lib/services/settings-service'
import { findRule, getEffectiveRulebook } from '@/lib/vim/rulebook'

// KAN-380: the vim keymap editor ignored the Ctrl flag both ways — the Ctrl+E /
// Ctrl+Y rows displayed bare 'e' / 'y', and re-recording Ctrl+E saved 'e'
// (killing Ctrl+E in the reader and binding plain e to scroll).
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

describe('KeymapSettings — Ctrl vim rules', () => {
  beforeEach(() => toastError.mockReset())

  it('shows the Ctrl modifier on the Ctrl+E / Ctrl+Y rows', () => {
    renderKeymap()
    expect(screen.getByRole('button', { name: 'Remap Scroll down (Ctrl+E), currently Ctrl+e' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remap Scroll up (Ctrl+Y), currently Ctrl+y' })).toBeTruthy()
    // Yank keeps its bare key.
    expect(screen.getByRole('button', { name: 'Remap Yank (copy), currently y' })).toBeTruthy()
  })

  it('records Ctrl+E as Ctrl+e', () => {
    const onChange = renderKeymap()
    record('Scroll down (Ctrl+E)', { key: 'e', ctrlKey: true })
    expect(onChange).toHaveBeenCalledWith({ 'normal:ctrl-e': 'Ctrl+e' })
  })

  it('records Ctrl+Y on Scroll up without a false Yank conflict', () => {
    const onChange = renderKeymap()
    record('Scroll up (Ctrl+Y)', { key: 'y', ctrlKey: true })
    expect(toastError).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledWith({ 'normal:ctrl-y': 'Ctrl+y' })
  })

  it('flags Ctrl+Y on Scroll down as a conflict with Scroll up', () => {
    const onChange = renderKeymap()
    record('Scroll down (Ctrl+E)', { key: 'y', ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toContain('Scroll up (Ctrl+Y)')
  })

  it('rejects a Ctrl combo the vim engine never dispatches', () => {
    const onChange = renderKeymap()
    record('Scroll down (Ctrl+E)', { key: 'k', ctrlKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(toastError.mock.calls[0][0]).toContain("can't be used for a Vim action")
  })

  it('shows a legacy bare-e override as custom with a per-row Reset', () => {
    renderKeymap({ 'normal:ctrl-e': 'e' })
    expect(screen.getByRole('button', { name: 'Remap Scroll down (Ctrl+E), currently e' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset Scroll down (Ctrl+E) to default (Ctrl+e)' })).toBeTruthy()
  })

  it('does not mark the default Ctrl+e as custom', () => {
    renderKeymap({ 'normal:ctrl-e': 'Ctrl+e' })
    expect(screen.queryByRole('button', { name: /^Reset Scroll down/ })).toBeNull()
  })
})

describe('getEffectiveRulebook — Ctrl overrides round-trip', () => {
  it('Ctrl+e binds the scroll rule to Ctrl+e only', () => {
    const rulebook = getEffectiveRulebook({ 'normal:ctrl-e': 'Ctrl+e' })
    expect(findRule('normal', 'e', false, true, rulebook)?.id).toBe('normal:ctrl-e')
    expect(findRule('normal', 'e', false, false, rulebook)).toBeUndefined()
  })

  it('parses Ctrl+Shift in recorder order', () => {
    const rule = getEffectiveRulebook({ 'normal:ctrl-e': 'Ctrl+Shift+E' }).find(r => r.id === 'normal:ctrl-e')
    expect(rule).toMatchObject({ key: 'E', ctrl: true, shift: true })
  })

  it('keeps a literal + key', () => {
    const rule = getEffectiveRulebook({ 'normal:ctrl-e': 'Shift++' }).find(r => r.id === 'normal:ctrl-e')
    expect(rule).toMatchObject({ key: '+', shift: true, ctrl: undefined })
  })
})
