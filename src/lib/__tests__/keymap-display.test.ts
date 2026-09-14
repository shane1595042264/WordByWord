import { describe, it, expect } from 'vitest'
import { formatKeyCombo, isUnbindableCombo } from '../keymap-display'

describe('formatKeyCombo', () => {
  describe('non-Mac (Windows/Linux) — textual modifiers', () => {
    it('renders modifiers as text joined with +', () => {
      expect(formatKeyCombo('Ctrl+Shift+l', { isMac: false })).toBe('Ctrl+Shift+l')
    })

    it('uppercases single-char literal keys when requested', () => {
      expect(formatKeyCombo('Ctrl+Shift+l', { isMac: false, upperKeys: true })).toBe('Ctrl+Shift+L')
    })

    it('maps meta to Win on non-Mac', () => {
      expect(formatKeyCombo('Meta+k', { isMac: false })).toBe('Win+k')
    })

    it('handles cmd alias as Win', () => {
      expect(formatKeyCombo('Cmd+s', { isMac: false })).toBe('Win+s')
    })
  })

  describe('Mac — glyphs', () => {
    it('renders modifier glyphs space-separated', () => {
      expect(formatKeyCombo('Ctrl+Shift+l', { isMac: true })).toBe('⌃ ⇧ l')
    })

    it('uppercases literal keys when requested', () => {
      expect(formatKeyCombo('Ctrl+Shift+l', { isMac: true, upperKeys: true })).toBe('⌃ ⇧ L')
    })

    it('concatenates glyphs when separator is empty (badge style)', () => {
      expect(formatKeyCombo('Ctrl+Shift+l', { isMac: true, separator: '' })).toBe('⌃⇧l')
    })

    it('maps meta/cmd to ⌘', () => {
      expect(formatKeyCombo('Meta+k', { isMac: true })).toBe('⌘ k')
      expect(formatKeyCombo('Cmd+k', { isMac: true })).toBe('⌘ k')
    })
  })

  describe('universal keys (both platforms)', () => {
    it('renders arrows identically', () => {
      expect(formatKeyCombo('Ctrl+ArrowLeft', { isMac: false })).toBe('Ctrl+←')
      expect(formatKeyCombo('Ctrl+ArrowLeft', { isMac: true })).toBe('⌃ ←')
    })

    it('renders Escape and Enter symbols', () => {
      expect(formatKeyCombo('Escape', { isMac: false })).toBe('Esc')
      expect(formatKeyCombo('Enter', { isMac: true })).toBe('↵')
    })
  })

  describe('edge cases', () => {
    it('handles a comma key (Ctrl+,)', () => {
      expect(formatKeyCombo('Ctrl+,', { isMac: false })).toBe('Ctrl+,')
    })

    it('handles a bare literal key', () => {
      expect(formatKeyCombo('1', { isMac: false })).toBe('1')
    })

    it('trims whitespace and drops empty parts', () => {
      expect(formatKeyCombo(' Ctrl + i ', { isMac: false })).toBe('Ctrl+i')
    })
  })
})

describe('isUnbindableCombo', () => {
  it('rejects a bare Tab — the only way a keyboard user moves focus', () => {
    expect(isUnbindableCombo('Tab')).toBe(true)
  })

  it('rejects a bare Escape — the universal cancel key', () => {
    expect(isUnbindableCombo('Escape')).toBe(true)
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(isUnbindableCombo(' tab ')).toBe(true)
    expect(isUnbindableCombo('ESCAPE')).toBe(true)
  })

  it('allows modified forms — only the bare key is load-bearing', () => {
    expect(isUnbindableCombo('Ctrl+Tab')).toBe(false)
    expect(isUnbindableCombo('Shift+Escape')).toBe(false)
    expect(isUnbindableCombo('Ctrl+Shift+Tab')).toBe(false)
  })

  it('leaves ordinary bindings alone', () => {
    expect(isUnbindableCombo('Ctrl+,')).toBe(false)
    expect(isUnbindableCombo('Shift+d')).toBe(false)
    expect(isUnbindableCombo('j')).toBe(false)
    expect(isUnbindableCombo('')).toBe(false)
  })
})
