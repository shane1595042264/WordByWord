import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useVimMode } from '../use-vim-mode'

/**
 * KAN-321: Ctrl+C must not be swallowed when the user has a real mouse
 * selection. A live DOM selection beats the vim cursor — which Continue
 * Reading restores on mount, so it is set even when the user never typed.
 */

function setNativeSelection(text: string | null) {
  const sel = text === null
    ? { isCollapsed: true, toString: () => '' }
    : { isCollapsed: false, toString: () => text }
  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection)
}

function useHarness(onYank: () => void) {
  const scrollRef = useRef<HTMLElement | null>(null)
  return useVimMode({ enabled: true, scrollRef, onYank })
}

function pressCtrlC() {
  const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
  act(() => { window.dispatchEvent(e) })
  return e
}

describe('useVimMode Ctrl+C / native copy precedence', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.restoreAllMocks() })

  it('lets the native copy through when a mouse selection exists', () => {
    setNativeSelection('a whole dragged sentence')
    const onYank = vi.fn()
    renderHook(() => useHarness(onYank))

    const e = pressCtrlC()

    expect(e.defaultPrevented).toBe(false)
    expect(onYank).not.toHaveBeenCalled()
  })

  it('still runs the vim yank when there is no DOM selection', () => {
    setNativeSelection(null)
    const onYank = vi.fn()
    renderHook(() => useHarness(onYank))

    const e = pressCtrlC()

    expect(e.defaultPrevented).toBe(true)
    expect(onYank).toHaveBeenCalledTimes(1)
  })

  it('treats a whitespace-only selection as no selection', () => {
    setNativeSelection('   \n  ')
    const onYank = vi.fn()
    renderHook(() => useHarness(onYank))

    const e = pressCtrlC()

    expect(e.defaultPrevented).toBe(true)
    expect(onYank).toHaveBeenCalledTimes(1)
  })

  it('does not intercept Ctrl+C while focus is in an input', () => {
    setNativeSelection('typed into a field')
    const onYank = vi.fn()
    renderHook(() => useHarness(onYank))

    const input = document.createElement('input')
    document.body.appendChild(input)
    const e = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
    act(() => { input.dispatchEvent(e) })

    expect(e.defaultPrevented).toBe(false)
    expect(onYank).not.toHaveBeenCalled()
  })
})
