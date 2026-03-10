'use client'

import type { VimMode } from '@/lib/vim'

interface VimStatusBarProps {
  mode: VimMode
  countBuffer: string
  enabled: boolean
}

/**
 * A minimal status bar that shows current Vim mode and count prefix.
 * Rendered at the bottom of the text pane (like Vim's status line).
 */
export function VimStatusBar({ mode, countBuffer, enabled }: VimStatusBarProps) {
  if (!enabled) return null

  const modeColors: Record<VimMode, string> = {
    normal: 'bg-zinc-700 text-zinc-100',
    select: 'bg-blue-600 text-white',
  }

  const modeLabels: Record<VimMode, string> = {
    normal: '-- NORMAL --',
    select: '-- SELECT --',
  }

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
      {countBuffer && (
        <span className="text-amber-400">{countBuffer}</span>
      )}
      <span className="ml-auto text-zinc-500 text-[10px]">
        {mode === 'normal' ? 'j/k scroll · d/u page · v select · ? help' : 'w word · s sent · V line · Esc exit'}
      </span>
    </div>
  )
}
