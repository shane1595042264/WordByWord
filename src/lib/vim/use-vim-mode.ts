'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { VimMode, VimRule } from './types'
import { findRule, RULEBOOK } from './rulebook'

const DEFAULT_LINE_HEIGHT = 24
const GG_TIMEOUT = 500

interface UseVimModeOptions {
  enabled: boolean
  scrollRef: React.RefObject<HTMLElement | null>
  onSelectWord?: (delta: number) => void
  onSelectSentence?: (delta: number) => void
  onSelectLine?: () => void
  onSelectToEnd?: () => void
  onSelectToStart?: () => void
  onClearSelection?: () => void
  onConfirmSelection?: () => void
  onSelectWordVertical?: (direction: number) => void
  onSelectSentenceVertical?: (direction: number) => void
  rulebook?: VimRule[]
}

interface UseVimModeReturn {
  mode: VimMode
  countBuffer: string
  enabled: boolean
}

export function useVimMode({
  enabled,
  scrollRef,
  onSelectWord,
  onSelectSentence,
  onSelectLine,
  onSelectToEnd,
  onSelectToStart,
  onClearSelection,
  onConfirmSelection,
  onSelectWordVertical,
  onSelectSentenceVertical,
  rulebook = RULEBOOK,
}: UseVimModeOptions): UseVimModeReturn {
  const [mode, setMode] = useState<VimMode>('normal')
  const [countBuffer, setCountBuffer] = useState('')
  const lastGTime = useRef(0)

  const getCount = useCallback((): number => {
    const n = parseInt(countBuffer, 10)
    return isNaN(n) || n < 1 ? 1 : n
  }, [countBuffer])

  const dispatchScroll = useCallback((direction: number, magnitude: number, count: number) => {
    const el = scrollRef.current
    if (!el) return
    if (magnitude < 1) {
      el.scrollBy({ top: el.clientHeight * magnitude * direction * count, behavior: 'smooth' })
    } else {
      el.scrollBy({ top: DEFAULT_LINE_HEIGHT * magnitude * direction * count, behavior: 'smooth' })
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
    if (e.ctrlKey || e.metaKey || e.altKey) return

    const key = e.key

    // Numeric prefix accumulation
    if (/^[0-9]$/.test(key) && !(countBuffer === '' && key === '0')) {
      e.preventDefault()
      setCountBuffer(prev => prev + key)
      return
    }

    // gg detection (double-tap g) — works in all modes
    if (key === 'g' && !e.shiftKey) {
      const now = Date.now()
      if (now - lastGTime.current < GG_TIMEOUT) {
        e.preventDefault()
        if (mode === 'visual') {
          // In visual mode, gg extends selection to start
          onSelectToStart?.()
        } else {
          // In normal/sentence, scroll to top and move cursor to first word
          dispatchScrollTo(-1)
          onSelectWord?.(-999999)
        }
        setCountBuffer('')
        lastGTime.current = 0
        return
      }
      lastGTime.current = now
      e.preventDefault()
      return
    }

    // Find matching rule
    const rule = findRule(mode, key, e.shiftKey, rulebook)
    if (!rule) {
      setCountBuffer('')
      return
    }

    e.preventDefault()
    const count = rule.acceptsCount ? getCount() : 1

    switch (rule.action.type) {
      case 'scroll':
        dispatchScroll(rule.action.direction ?? 1, rule.action.magnitude ?? 1, count)
        break

      case 'scroll-to': {
        const dir = rule.action.direction ?? 1
        dispatchScrollTo(dir)
        // Also move word cursor to top/bottom
        if (dir < 0) {
          onSelectWord?.(-999999)
        } else {
          onSelectWord?.(999999)
        }
        break
      }

      case 'select-word':
        if (onSelectWord) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) onSelectWord(dir)
        }
        break

      case 'select-word-vertical':
        if (onSelectWordVertical) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) onSelectWordVertical(dir)
        }
        break

      case 'select-sentence':
        if (onSelectSentence) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) onSelectSentence(dir)
        }
        break

      case 'select-sentence-vertical':
        if (onSelectSentenceVertical) {
          const dir = rule.action.direction ?? 1
          for (let i = 0; i < count; i++) onSelectSentenceVertical(dir)
        }
        break

      case 'select-line':
        // Enter visual mode from any non-visual mode, then select line
        if (mode !== 'visual') setMode('visual')
        onSelectLine?.()
        break

      case 'select-to-end':
        onSelectToEnd?.()
        break

      case 'select-to-start':
        onSelectToStart?.()
        break

      case 'confirm-selection':
        onConfirmSelection?.()
        break

      case 'mode-change':
        if (rule.action.targetMode) {
          const target = rule.action.targetMode
          setMode(target)
          // On entering sentence mode, select first visible sentence
          if (target === 'sentence') {
            onSelectSentence?.(0)
          }
          // On entering visual mode, keep current word as anchor
          // (don't move, just change mode)
        }
        break

      case 'escape':
        setMode('normal')
        onClearSelection?.()
        break

      case 'custom':
        break
    }

    setCountBuffer('')
  }, [enabled, mode, countBuffer, getCount, dispatchScroll, dispatchScrollTo, onSelectWord, onSelectWordVertical, onSelectSentence, onSelectSentenceVertical, onSelectLine, onSelectToEnd, onSelectToStart, onClearSelection, onConfirmSelection, rulebook])

  useEffect(() => {
    if (!enabled) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, handleKeyDown])

  useEffect(() => {
    if (!enabled) {
      setMode('normal')
      setCountBuffer('')
    }
  }, [enabled])

  return { mode, countBuffer, enabled }
}
