import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useVimMode } from '../use-vim-mode'

/**
 * KAN-339: Enter on a focused button or link must keep its native activation
 * instead of being mapped to confirm-selection (the translate popup).
 */

function useHarness(onConfirmSelection: () => void, onSelectWord: (d: number) => void) {
  const scrollRef = useRef<HTMLElement | null>(null)
  return useVimMode({ enabled: true, scrollRef, onConfirmSelection, onSelectWord })
}

function pressOn(target: EventTarget, key: string) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(e) })
  return e
}

describe('useVimMode focused-control precedence', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.restoreAllMocks() })

  it.each([
    ['button', () => document.createElement('button')],
    ['link', () => { const a = document.createElement('a'); a.href = '/book/1'; return a }],
    ['role=button', () => { const d = document.createElement('div'); d.setAttribute('role', 'button'); return d }],
  ])('lets Enter through on a focused %s', (_label, make) => {
    const onConfirm = vi.fn()
    renderHook(() => useHarness(onConfirm, vi.fn()))
    const el = make()
    document.body.appendChild(el)

    const e = pressOn(el, 'Enter')

    expect(e.defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('lets Enter through on an element nested inside a button', () => {
    const onConfirm = vi.fn()
    renderHook(() => useHarness(onConfirm, vi.fn()))
    const btn = document.createElement('button')
    const icon = document.createElement('span')
    btn.appendChild(icon)
    document.body.appendChild(btn)

    const e = pressOn(icon, 'Enter')

    expect(e.defaultPrevented).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('still confirms the selection on Enter from the reading surface', () => {
    const onConfirm = vi.fn()
    renderHook(() => useHarness(onConfirm, vi.fn()))

    const e = pressOn(document.body, 'Enter')

    expect(e.defaultPrevented).toBe(true)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps vim motions working while a button holds focus', () => {
    const onSelectWord = vi.fn()
    renderHook(() => useHarness(vi.fn(), onSelectWord))
    const btn = document.createElement('button')
    document.body.appendChild(btn)

    const e = pressOn(btn, 'l')

    expect(e.defaultPrevented).toBe(true)
    expect(onSelectWord).toHaveBeenCalledTimes(1)
  })
})
