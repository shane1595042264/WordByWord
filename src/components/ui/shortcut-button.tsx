'use client'

import { useEffect, useCallback, type ReactNode, type MouseEvent } from 'react'
import { useShortcuts } from '@/hooks/use-shortcuts'

interface ShortcutButtonProps {
  /** Unique shortcut ID (e.g. 'word-panel:add-vocab') */
  shortcutId: string
  /** Human-readable label */
  label: string
  /** Default key combo (e.g. 'a' or 'Ctrl+s'). Keep simple for inline buttons. */
  defaultKeys: string
  /** Click/shortcut handler */
  onClick: () => void
  /** Whether to show the shortcut hint badge */
  showHint?: boolean
  /** Additional class names */
  className?: string
  /** Disabled state */
  disabled?: boolean
  /** Children (button content) */
  children: ReactNode
}

/**
 * A button that auto-registers itself as a keyboard shortcut.
 * Shows a small key hint badge so users know the shortcut.
 * Every button in the app should use this component.
 */
export function ShortcutButton({
  shortcutId,
  label,
  defaultKeys,
  onClick,
  showHint = true,
  className = '',
  disabled = false,
  children,
}: ShortcutButtonProps) {
  const { register, unregister, getKeysDisplay } = useShortcuts()

  const stableAction = useCallback(() => {
    if (!disabled) onClick()
  }, [onClick, disabled])

  useEffect(() => {
    register({ id: shortcutId, label, defaultKeys, action: stableAction })
    return () => unregister(shortcutId)
  }, [shortcutId, label, defaultKeys, stableAction, register, unregister])

  const handleClick = useCallback((e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) onClick()
  }, [onClick, disabled])

  const hint = getKeysDisplay(shortcutId) ?? defaultKeys.toUpperCase()

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      className={`
        relative inline-flex items-center gap-1.5
        transition-colors
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
        ${className}
      `}
      title={`${label} (${hint})`}
    >
      {children}
      {showHint && (
        <kbd className="
          inline-flex items-center justify-center
          min-w-[1.25rem] h-[1.125rem] px-1
          text-[10px] font-mono leading-none
          bg-muted/60 text-muted-foreground/70
          border border-border/40 rounded
          pointer-events-none select-none
        ">
          {hint}
        </kbd>
      )}
    </button>
  )
}
