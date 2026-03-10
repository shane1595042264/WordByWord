'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RULEBOOK } from '@/lib/vim/rulebook'
import type { VimRule } from '@/lib/vim/types'
import type { KeymapOverrides } from '@/lib/services/settings-service'

interface KeymapSettingsProps {
  overrides: KeymapOverrides
  onChange: (overrides: KeymapOverrides) => void
}

/** Display a key nicely */
function KeyBadge({ keyStr, variant = 'outline' }: { keyStr: string; variant?: 'outline' | 'default' }) {
  const display = keyStr
    .replace('ArrowUp', '↑')
    .replace('ArrowDown', '↓')
    .replace('ArrowLeft', '←')
    .replace('ArrowRight', '→')
    .replace('Escape', 'Esc')
    .replace('Enter', '↵')
    .replace('Shift+', '⇧')
  return (
    <Badge variant={variant} className="font-mono text-xs px-2 py-0.5">
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

      {filteredRules.length === 0 && (
        <div className="text-center text-muted-foreground py-8 text-sm">
          No keybindings match "{search}"
        </div>
      )}
    </div>
  )
}
