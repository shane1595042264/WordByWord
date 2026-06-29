import { describe, it, expect } from 'vitest'
import { formatKeyCombo } from '../keymap-display'

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
