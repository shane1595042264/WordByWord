'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RULEBOOK } from '@/lib/vim/rulebook'
import type { VimRule } from '@/lib/vim/types'
import type { KeymapOverrides } from '@/lib/services/settings-service'

// ─── Global Shortcuts (non-Vim, combo-key shortcuts) ────────────────────────

export interface GlobalShortcutDef {
  id: string
  label: string
  defaultKeys: string
  description: string
}

export const GLOBAL_SHORTCUTS: GlobalShortcutDef[] = [
  { id: 'prev-page', label: 'Previous Page', defaultKeys: 'Ctrl+ArrowLeft', description: 'Go to previous page or section' },
  { id: 'next-page', label: 'Next Page', defaultKeys: 'Ctrl+ArrowRight', description: 'Go to next page or section' },
  { id: 'view-pdf', label: 'PDF View', defaultKeys: 'Ctrl+1', description: 'Switch to PDF view mode' },
  { id: 'view-text', label: 'Text View', defaultKeys: 'Ctrl+2', description: 'Switch to text view mode' },
  { id: 'view-side-by-side', label: 'Side-by-Side View', defaultKeys: 'Ctrl+3', description: 'Switch to side-by-side view mode' },
  { id: 'toggle-indicators', label: 'Toggle Element Labels', defaultKeys: 'Ctrl+i', description: 'Show/hide paragraph badges' },
  { id: 'toggle-line-numbers', label: 'Toggle Line Numbers', defaultKeys: 'Ctrl+Shift+l', description: 'Show/hide relative line numbers' },
  { id: 'toggle-user-menu', label: 'User Menu', defaultKeys: 'Ctrl+m', description: 'Open/close the profile dropdown menu' },
  { id: 'open-settings', label: 'Open Settings', defaultKeys: 'Ctrl+,', description: 'Open the settings page' },
  { id: 'open-keymap', label: 'Keyboard Shortcuts', defaultKeys: 'Ctrl+]', description: 'Open the keyboard customization settings' },
]

interface KeymapSettingsProps {
  overrides: KeymapOverrides
  onChange: (overrides: KeymapOverrides) => void
}

/** Map a single key-combo part to its display symbol */
const KEY_SYMBOLS: Record<string, string> = {
  Ctrl: '⌃',
  Shift: '⇧',
  Alt: '⌥',
  Meta: '⌘',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Enter: '↵',
}

/** Display a key nicely */
function KeyBadge({ keyStr, variant = 'outline' }: { keyStr: string; variant?: 'outline' | 'default' }) {
  const display = keyStr
    .split('+')
    .map(part => KEY_SYMBOLS[part] ?? part)
    .join('')
  return (
    <Badge variant={variant} className="font-mono text-xs px-2 py-0.5 rounded-md overflow-visible">
      {display}
    </Badge>
  )
}

/** Format the default key for a rule */
function getDefaultKeyDisplay(rule: VimRule): string {
  if (rule.shift) return `Shift+${rule.key}`
  return rule.key
}

/** Single keymap row with inline remap */
function KeymapRow({
  rule,
  customKey,
  onRemap,
  onReset,
}: {
  rule: VimRule
  customKey?: string
  onRemap: (ruleId: string, newKey: string) => void
  onReset: (ruleId: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const recordRef = useRef<HTMLButtonElement>(null)

  const defaultKey = getDefaultKeyDisplay(rule)
  const currentKey = customKey || defaultKey
  const isCustom = !!customKey && customKey !== defaultKey

  useEffect(() => {
    if (!recording) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Ignore lone modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

      let keyStr = e.key
      if (e.shiftKey && keyStr.length === 1) {
        keyStr = `Shift+${keyStr}`
      }

      onRemap(rule.id, keyStr)
      setRecording(false)
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording, rule.id, onRemap])

  // Cancel recording on blur
  useEffect(() => {
    if (!recording) return
    const handler = () => setRecording(false)
    const btn = recordRef.current
    btn?.addEventListener('blur', handler)
    return () => btn?.removeEventListener('blur', handler)
  }, [recording])

  const modeColors: Record<string, string> = {
    normal: 'text-blue-400',
    select: 'text-amber-400',
  }

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors group">
      {/* Modes */}
      <div className="w-24 shrink-0 flex gap-1">
        {rule.modes.map(m => (
          <span key={m} className={`text-[10px] font-mono uppercase ${modeColors[m] || 'text-muted-foreground'}`}>
            {m}
          </span>
        ))}
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{rule.label}</div>
        <div className="text-xs text-muted-foreground truncate">{rule.description}</div>
      </div>

      {/* Current key */}
      <div className="shrink-0 flex items-center gap-2">
        {recording ? (
          <button
            ref={recordRef}
            autoFocus
            className="px-3 py-1 text-xs border-2 border-amber-500 rounded-md bg-amber-500/10 text-amber-400 animate-pulse font-mono"
          >
            Press a key...
          </button>
        ) : (
          <button
            onClick={() => setRecording(true)}
            className="cursor-pointer hover:ring-2 hover:ring-primary/30 rounded transition-all"
            title="Click to remap"
          >
            <KeyBadge keyStr={currentKey} variant={isCustom ? 'default' : 'outline'} />
          </button>
        )}

        {isCustom && (
          <button
            onClick={() => onReset(rule.id)}
            className="text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            title={`Reset to default (${defaultKey})`}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}

/** Single row for a global (combo-key) shortcut with inline remap */
function GlobalShortcutRow({
  shortcut,
  customKeys,
  onRemap,
  onReset,
}: {
  shortcut: GlobalShortcutDef
  customKeys?: string
  onRemap: (id: string, newKeys: string) => void
  onReset: (id: string) => void
}) {
  const [recording, setRecording] = useState(false)
  const recordRef = useRef<HTMLButtonElement>(null)

  const currentKeys = customKeys || shortcut.defaultKeys
  const isCustom = !!customKeys && customKeys !== shortcut.defaultKeys

  useEffect(() => {
    if (!recording) return

    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Ignore lone modifier keys
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      if (e.metaKey) parts.push('Meta')
      parts.push(e.key)

      onRemap(shortcut.id, parts.join('+'))
      setRecording(false)
    }

    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording, shortcut.id, onRemap])

  // Cancel recording on blur
  useEffect(() => {
    if (!recording) return
    const handler = () => setRecording(false)
    const btn = recordRef.current
    btn?.addEventListener('blur', handler)
    return () => btn?.removeEventListener('blur', handler)
  }, [recording])

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md hover:bg-muted/50 transition-colors group">
      {/* Label: "global" */}
      <div className="w-24 shrink-0 flex gap-1">
        <span className="text-[10px] font-mono uppercase text-emerald-400">global</span>
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{shortcut.label}</div>
        <div className="text-xs text-muted-foreground truncate">{shortcut.description}</div>
      </div>

      {/* Current key */}
      <div className="shrink-0 flex items-center gap-2">
        {recording ? (
          <button
            ref={recordRef}
            autoFocus
            className="px-3 py-1 text-xs border-2 border-amber-500 rounded-md bg-amber-500/10 text-amber-400 animate-pulse font-mono"
          >
            Press a key combo...
          </button>
        ) : (
          <button
            onClick={() => setRecording(true)}
            className="cursor-pointer hover:ring-2 hover:ring-primary/30 rounded transition-all"
            title="Click to remap"
          >
            <KeyBadge keyStr={currentKeys} variant={isCustom ? 'default' : 'outline'} />
          </button>
        )}

        {isCustom && (
          <button
            onClick={() => onReset(shortcut.id)}
            className="text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
            title={`Reset to default (${shortcut.defaultKeys})`}
          >
            ↺
          </button>
        )}
      </div>
    </div>
  )
}

export function KeymapSettings({ overrides, onChange }: KeymapSettingsProps) {
  const [search, setSearch] = useState('')

  const handleRemap = useCallback((ruleId: string, newKey: string) => {
    onChange({ ...overrides, [ruleId]: newKey })
  }, [overrides, onChange])

  const handleReset = useCallback((ruleId: string) => {
    const next = { ...overrides }
    delete next[ruleId]
    onChange(next)
  }, [overrides, onChange])

  const handleResetAll = useCallback(() => {
    onChange({})
  }, [onChange])

  // Filter rules by search
  const filteredRules = RULEBOOK.filter(rule => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      rule.label.toLowerCase().includes(q) ||
      rule.description.toLowerCase().includes(q) ||
      rule.key.toLowerCase().includes(q) ||
      rule.id.toLowerCase().includes(q) ||
      rule.modes.some(m => m.toLowerCase().includes(q))
    )
  })

  // Filter global shortcuts by search
  const filteredGlobal = GLOBAL_SHORTCUTS.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.defaultKeys.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q) ||
      'global'.includes(q)
    )
  })

  // Group by mode for display
  const normalRules = filteredRules.filter(r => r.modes.includes('normal') && r.modes.length === 1)
  const sentenceRules = filteredRules.filter(r => r.modes.includes('sentence') && !r.modes.includes('normal'))
  const visualRules = filteredRules.filter(r => r.modes.includes('visual') && !r.modes.includes('normal'))
  const sharedRules = filteredRules.filter(r => r.modes.length > 1 && r.modes.includes('normal'))

  const hasOverrides = Object.keys(overrides).length > 0

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search keybindings..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1"
        />
        {hasOverrides && (
          <Button variant="outline" size="sm" onClick={handleResetAll}>
            Reset All
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Click any key badge to remap it. Press the new key to confirm. Changes apply immediately.
      </p>

      {filteredGlobal.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Navigation & Views
          </h3>
          <div className="border rounded-lg divide-y divide-border/50">
            {filteredGlobal.map(s => (
              <GlobalShortcutRow
                key={s.id}
                shortcut={s}
                customKeys={overrides[s.id]}
                onRemap={handleRemap}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      )}

      {normalRules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Normal Mode
          </h3>
          <div className="border rounded-lg divide-y divide-border/50">
            {normalRules.map(rule => (
              <KeymapRow
                key={rule.id}
                rule={rule}
                customKey={overrides[rule.id]}
                onRemap={handleRemap}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      )}

      {sentenceRules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Sentence Mode
          </h3>
          <div className="border rounded-lg divide-y divide-border/50">
            {sentenceRules.map(rule => (
              <KeymapRow
                key={rule.id}
                rule={rule}
                customKey={overrides[rule.id]}
                onRemap={handleRemap}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      )}

      {visualRules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Visual Mode
          </h3>
          <div className="border rounded-lg divide-y divide-border/50">
            {visualRules.map(rule => (
              <KeymapRow
                key={rule.id}
                rule={rule}
                customKey={overrides[rule.id]}
                onRemap={handleRemap}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      )}

      {sharedRules.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Shared (Multiple Modes)
          </h3>
          <div className="border rounded-lg divide-y divide-border/50">
            {sharedRules.map(rule => (
              <KeymapRow
                key={rule.id}
                rule={rule}
                customKey={overrides[rule.id]}
                onRemap={handleRemap}
                onReset={handleReset}
              />
            ))}
          </div>
        </div>
      )}

      {filteredRules.length === 0 && filteredGlobal.length === 0 && (
        <div className="text-center text-muted-foreground py-8 text-sm">
          No keybindings match &quot;{search}&quot;
        </div>
      )}
    </div>
  )
}
