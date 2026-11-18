import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useVimMode } from '../use-vim-mode'

/**
 * KAN-409: W and S dispatch to their own callbacks (once per count) instead of
 * the old placeholders — W was plain w, S was 3 sentence hops per press.
 */

function useHarness(cbs: Partial<Parameters<typeof useVimMode>[0]>) {
  const scrollRef = useRef<HTMLElement | null>(null)
  return useVimMode({ enabled: true, scrollRef, ...cbs })
}

function press(key: string, shiftKey = false) {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })) })
}

describe('useVimMode W / S', () => {
  it('3W calls onSelectBigWord three times and never onSelectWord', () => {
    const onSelectBigWord = vi.fn()
    const onSelectWord = vi.fn()
    renderHook(() => useHarness({ onSelectBigWord, onSelectWord }))
    press('3')
    press('W', true)
    expect(onSelectBigWord.mock.calls).toEqual([[1], [1], [1]])
    expect(onSelectWord).not.toHaveBeenCalled()
  })

  it('2S in sentence mode calls onSelectParagraph twice and onSelectSentence only for mode entry', () => {
    const onSelectParagraph = vi.fn()
    const onSelectSentence = vi.fn()
    renderHook(() => useHarness({ onSelectParagraph, onSelectSentence }))
    press('s')
    expect(onSelectSentence.mock.calls).toEqual([[0]])
    press('2')
    press('S', true)
    expect(onSelectParagraph.mock.calls).toEqual([[1], [1]])
    expect(onSelectSentence.mock.calls).toEqual([[0]])
  })
})
