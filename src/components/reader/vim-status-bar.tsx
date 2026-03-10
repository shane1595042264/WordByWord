'use client'

import type { VimMode } from '@/lib/vim'

interface VimStatusBarProps {
  mode: VimMode
  countBuffer: string
  enabled: boolean
}

/**
 * Minimal status bar showing current Vim mode and hints.
 */
export function VimStatusBar({ mode, countBuffer, enabled }: VimStatusBarProps) {
  if (!enabled) return null

  const modeColors: Record<VimMode, string> = {
    normal: 'bg-zinc-700 text-zinc-100',
    word: 'bg-teal-600 text-white',
    sentence: 'bg-amber-600 text-white',
    visual: 'bg-blue-600 text-white',
  }

  const modeLabels: Record<VimMode, string> = {
    normal: '-- NORMAL --',
    word: '-- WORD --',
    sentence: '-- SENTENCE --',
    visual: '-- VISUAL --',
  }

  const hints: Record<VimMode, string> = {
    normal: 'j/k cursor · d/u page · w word · s sent · v visual',
    word: 'h/l word · j/k line · Enter translate · Esc exit',
    sentence: 'h/l sent · j/k line · Enter translate · Esc exit',
    visual: 'h/l extend · j/k line · V line · Esc exit',
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
        {hints[mode]}
      </span>
    </div>
  )
}
