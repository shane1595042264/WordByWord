'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { VimMode, VimContext, VimRule } from './types'
import { findRule, RULEBOOK } from './rulebook'

const DEFAULT_LINE_HEIGHT = 24 // px per "line" for j/k scrolling
const GG_TIMEOUT = 500 // ms to detect gg double-tap

interface UseVimModeOptions {
  /** Is vim mode enabled? */
  enabled: boolean
  /** Ref to the text scroll container */
  scrollRef: React.RefObject<HTMLElement | null>
  /** Called when a word should be selected (delta from current) */
  onSelectWord?: (delta: number) => void
  /** Called when a sentence should be selected (delta from current) */
  onSelectSentence?: (delta: number) => void
  /** Called when the current visual line should be selected */
  onSelectLine?: () => void
  /** Called when selection should be cleared */
  onClearSelection?: () => void
  /** Called when user confirms selection (Enter key — show info panel) */
  onConfirmSelection?: () => void
  /** Called when word cursor should move vertically (j/k in select mode) */
  onSelectWordVertical?: (direction: number) => void
  /** Custom rulebook (with user keybinding overrides applied) */
  rulebook?: VimRule[]
}

interface UseVimModeReturn {
  /** Current vim mode */
  mode: VimMode
  /** Current numeric prefix buffer (e.g. "23") */
  countBuffer: string
  /** Whether vim mode is active */
  enabled: boolean
}

export function useVimMode({
  enabled,
  scrollRef,
  onSelectWord,
  onSelectSentence,
  onSelectLine,
  onClearSelection,
  onConfirmSelection,
  onSelectWordVertical,
  rulebook = RULEBOOK,
}: UseVimModeOptions): UseVimModeReturn {
  const [mode, setMode] = useState<VimMode>('normal')
  const [countBuffer, setCountBuffer] = useState('')
  const lastGTime = useRef(0)

  // Get effective count from buffer (minimum 1)
  const getCount = useCallback((): number => {
    const n = parseInt(countBuffer, 10)
    return isNaN(n) || n < 1 ? 1 : n
  }, [countBuffer])

  // ── Action dispatchers ──

  const dispatchScroll = useCallback((direction: number, magnitude: number, count: number) => {
    const el = scrollRef.current
    if (!el) return

    if (magnitude < 1) {
      // Half-page scroll
      const amount = el.clientHeight * magnitude * direction * count
      el.scrollBy({ top: amount, behavior: 'smooth' })
    } else {
      // Line-based scroll
      const amount = DEFAULT_LINE_HEIGHT * magnitude * direction * count
      el.scrollBy({ top: amount, behavior: 'smooth' })
    }
  }, [scrollRef])

  const dispatchScrollTo = useCallback((direction: number) => {
    const el = scrollRef.current
    if (!el) return
    if (direction < 0) {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [scrollRef])

  // ── Main keydown handler ──

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    // Don't intercept when typing in inputs
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

    // Don't intercept when modifier keys are held (let browser/app shortcuts through)
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const key = e.key

    // ── Numeric prefix accumulation ──
    if (/^[0-9]$/.test(key) && !(countBuffer === '' && key === '0')) {
      e.preventDefault()
      setCountBuffer(prev => prev + key)
      return
    }

    // ── gg detection (double-tap g) ──
    if (key === 'g' && !e.shiftKey && mode === 'normal') {
      const now = Date.now()
      if (now - lastGTime.current < GG_TIMEOUT) {
        // gg — go to top
        e.preventDefault()
        dispatchScrollTo(-1)
        setCountBuffer('')
        lastGTime.current = 0
        return
      }
      lastGTime.current = now
      e.preventDefault()
      return
    }

    // ── Find matching rule ──
    const rule = findRule(mode, key, e.shiftKey, rulebook)
    if (!rule) {
      // No match — reset count buffer on non-numeric, non-matching key
      setCountBuffer('')
      return
    }

    e.preventDefault()
    const count = rule.acceptsCount ? getCount() : 1

    switch (rule.action.type) {
      case 'scroll':
        dispatchScroll(
          rule.action.direction ?? 1,
          rule.action.magnitude ?? 1,
          count,
        )
        break

      case 'scroll-to':
        dispatchScrollTo(rule.action.direction ?? 1)
        break

      case 'select-word':
        if (onSelectWord) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) {
            onSelectWord(dir)
          }
        }
        break

      case 'select-word-vertical':
        if (onSelectWordVertical) {
          const vDir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) {
            onSelectWordVertical(vDir)
          }
        }
        break

      case 'select-sentence':
        if (onSelectSentence) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) {
            onSelectSentence(dir)
          }
        }
        break

      case 'select-line':
        // Also enter select mode if in normal
        if (mode === 'normal') setMode('select')
        onSelectLine?.()
        break

      case 'confirm-selection':
        onConfirmSelection?.()
        break

      case 'mode-change':
        if (rule.action.targetMode) {
          setMode(rule.action.targetMode)
          // On entering select mode, select the first visible word
          if (rule.action.targetMode === 'select') {
            onSelectWord?.(0) // delta 0 = select first visible
          }
        }
        break

      case 'escape':
        if (mode === 'select') {
          setMode('normal')
          onClearSelection?.()
        }
        break

      case 'custom':
        // Future extensibility
        break
    }

    // Reset count buffer after action
    setCountBuffer('')
  }, [enabled, mode, countBuffer, getCount, dispatchScroll, dispatchScrollTo, onSelectWord, onSelectWordVertical, onSelectSentence, onSelectLine, onClearSelection, onConfirmSelection, rulebook])

  // ── Attach global listener ──
  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])

  // Reset mode when disabled
  useEffect(() => {
    if (!enabled) {
      setMode('normal')
      setCountBuffer('')
    }
  }, [enabled])

  return { mode, countBuffer, enabled }
}
