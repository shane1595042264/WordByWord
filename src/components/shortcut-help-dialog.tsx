'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SettingsService } from '@/lib/services/settings-service'
import { AI_KEY_SETUP_HREF, needsAiKeySetup, searchShortcutsWithAi } from '@/lib/services/ai-api'
import { buildShortcutCatalog, describeForAi, matchShortcuts, type ShortcutEntry } from '@/lib/shortcut-catalog'
import { formatKeyCombo, useIsMac } from '@/lib/keymap-display'

const KEYMAP_HREF = '/settings?tab=keymap'

type AiState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; ids: string[] }
  | { status: 'error'; message: string; needsKey: boolean }

function ShortcutRow({ entry }: { entry: ShortcutEntry }) {
  const isMac = useIsMac()
  return (
    <li className="flex items-center gap-3 py-2 px-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{entry.label}</div>
        <div className="text-xs text-muted-foreground">{entry.description}</div>
      </div>
      <span className="shrink-0 text-[10px] font-mono uppercase text-muted-foreground">{entry.scope}</span>
      <Badge variant="outline" className="shrink-0 font-mono text-xs px-2 py-0.5 rounded-md">
        {formatKeyCombo(entry.keys, { isMac, separator: isMac ? '' : '+' })}
      </Badge>
    </li>
  )
}

/**
 * The ? dialog (KAN-407): every shortcut with the keys it fires on now, a
 * word search, and — when no shortcut's words match — an "Ask AI" fallback
 * that runs on the reader's own key. Remapping stays in Settings > Keymap.
 */
export function ShortcutHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<ShortcutEntry[]>([])
  const [ai, setAi] = useState<AiState>({ status: 'idle' })
  // Bumped on every new question, so a slow answer to an older one is dropped.
  const askSeq = useRef(0)

  // Re-read the keymap each time the dialog opens, so a remap made since shows.
  useEffect(() => {
    if (!open) return
    setCatalog(buildShortcutCatalog(new SettingsService().getSettings().keymapOverrides))
    setQuery('')
    setAi({ status: 'idle' })
    askSeq.current++
  }, [open])

  const matches = useMemo(() => matchShortcuts(catalog, query), [catalog, query])
  const trimmed = query.trim()
  const canAskAi = trimmed.length > 0 && matches.length === 0

  const askAi = async () => {
    if (!canAskAi || ai.status === 'loading') return
    const seq = ++askSeq.current
    setAi({ status: 'loading' })
    try {
      const ids = await searchShortcutsWithAi(trimmed, catalog.map(describeForAi))
      if (seq === askSeq.current) setAi({ status: 'done', ids })
    } catch (err) {
      if (seq !== askSeq.current) return
      setAi({
        status: 'error',
        message: err instanceof Error ? err.message : 'Shortcut search failed — try again.',
        needsKey: needsAiKeySetup(err),
      })
    }
  }

  const aiMatches = ai.status === 'done'
    ? ai.ids.map(id => catalog.find(e => e.id === id)).filter((e): e is ShortcutEntry => !!e)
    : []

  const close = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Search by name, or describe what you want to do.{' '}
            <Link href={KEYMAP_HREF} onClick={close} className="font-medium text-primary underline underline-offset-2 hover:no-underline">
              Customize keys
            </Link>
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          placeholder="Search shortcuts…"
          aria-label="Search shortcuts"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            askSeq.current++
            setAi({ status: 'idle' })
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void askAi()
            }
          }}
        />

        <div className="min-h-0 overflow-y-auto -mx-2">
          {matches.length > 0 ? (
            <ul className="divide-y divide-border/50">
              {matches.map(e => <ShortcutRow key={e.id} entry={e} />)}
            </ul>
          ) : (
            <div className="px-3 py-4 space-y-3 text-sm">
              <p className="text-muted-foreground">No shortcut matches &quot;{trimmed}&quot;.</p>
              {ai.status !== 'done' && (
                <Button variant="outline" size="sm" onClick={() => void askAi()} disabled={ai.status === 'loading'}>
                  <Sparkles className="size-4" />
                  {ai.status === 'loading' ? 'Asking AI…' : 'Ask AI'}
                </Button>
              )}
              {ai.status === 'error' && (
                <p role="alert" className="text-destructive">
                  {ai.message}
                  {ai.needsKey && (
                    <Link href={AI_KEY_SETUP_HREF} onClick={close} className="ml-1 font-medium text-primary underline underline-offset-2 hover:no-underline">
                      Open AI settings
                    </Link>
                  )}
                </p>
              )}
              {ai.status === 'done' && (
                aiMatches.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">AI suggestions</p>
                    <ul className="divide-y divide-border/50 -mx-3">
                      {aiMatches.map(e => <ShortcutRow key={e.id} entry={e} />)}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground">AI found no shortcut for that either.</p>
                )
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
