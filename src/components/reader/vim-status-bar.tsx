'use client'

import type { VimMode, VimSelectSubMode } from '@/lib/vim'

interface VimStatusBarProps {
  mode: VimMode
  selectSubMode: VimSelectSubMode
  countBuffer: string
  enabled: boolean
}

/**
 * A minimal status bar that shows current Vim mode, sub-mode, and count prefix.
 * Rendered at the bottom of the text pane (like Vim's status line).
 */
export function VimStatusBar({ mode, selectSubMode, countBuffer, enabled }: VimStatusBarProps) {
  if (!enabled) return null

  const modeColors: Record<VimMode, string> = {
    normal: 'bg-zinc-700 text-zinc-100',
    select: 'bg-blue-600 text-white',
  }

  const subModeColors: Record<VimSelectSubMode, string> = {
    word: 'bg-teal-600 text-white',
    sentence: 'bg-amber-600 text-white',
  }

  const modeLabels: Record<VimMode, string> = {
    normal: '-- NORMAL --',
    select: '-- SELECT --',
  }

  const subModeLabels: Record<VimSelectSubMode, string> = {
    word: 'WORD',
    sentence: 'SENT',
  }

  const selectHints = selectSubMode === 'sentence'
    ? 'h/l sent · j/k line · w word mode · Esc exit'
    : 'h/l word · j/k line · s sent mode · Esc exit'

  return (
    <div className="
      flex items-center gap-3 px-3 py-1
      bg-zinc-900 text-zinc-300 text-xs font-mono
      border-t border-zinc-700
      select-none
    ">
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${modeColors[mode]}`}>
        {modeLabels[mode]}
      </span>
      {mode === 'select' && (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${subModeColors[selectSubMode]}`}>
          {subModeLabels[selectSubMode]}
        </span>
      )}
      {countBuffer && (
        <span className="text-amber-400">{countBuffer}</span>
      )}
      <span className="ml-auto text-zinc-500 text-[10px]">
        {mode === 'normal' ? 'j/k cursor · d/u page · v select · ? help' : selectHints}
      </span>
    </div>
  )
}
