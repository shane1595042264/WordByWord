'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { KeyRoundIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AI_PROVIDER_LABEL,
  addAiKey,
  detectKeyProvider,
  fetchAiKeys,
  fetchAiUsage,
  recheckAiKey,
  removeAiKey,
  saveAiSettings,
  setAiKeyModel,
  type AiKey,
  type AiProvider,
  type AiSettings,
  type AiUsage,
} from '@/lib/services/ai-api'
import { SettingsService } from '@/lib/services/settings-service'

const FEATURE_LABEL: Record<string, string> = {
  validate: 'Key checks',
  'translate-word': 'Word translations',
  'translate-sentence': 'Sentence translations',
  'explain-translation': 'Word explanations',
  'explain-content': 'Table and code explanations',
  'explain-image': 'Figure explanations',
  ocr: 'Scanned-page text (import)',
  'processing-ocr': 'Scanned-page text (upload)',
  toc: 'AI Suggest for contents',
  'split-sections': 'Section splitting',
}

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50'

/** Costs are estimates in micro-dollars; small ones keep four decimals so they don't all read $0.00. */
export function formatUsd(micro: number): string {
  const usd = micro / 1_000_000
  if (usd === 0) return '$0.00'
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`
}

const formatCount = (n: number) => n.toLocaleString('en-US')

const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again.')

export function AiKeysSettings() {
  const [keys, setKeys] = useState<AiKey[] | null>(null)
  const [settings, setSettings] = useState<AiSettings>({ preferredProvider: null })
  const [usage, setUsage] = useState<AiUsage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null)
  const [legacyKey, setLegacyKey] = useState<string | null>(null)

  const loadUsage = useCallback(() => {
    fetchAiUsage(30).then(setUsage, () => setUsage(null))
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const data = await fetchAiKeys()
      setKeys(data.keys)
      setSettings(data.settings)
      loadUsage()
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [loadUsage])

  useEffect(() => {
    load()
    setLegacyKey(new SettingsService().legacyAnthropicKey())
  }, [load])

  const replaceKey = (next: AiKey) =>
    setKeys((prev) => {
      const rest = (prev ?? []).filter((k) => k.id !== next.id && k.provider !== next.provider)
      return [...rest, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    })

  const submitKey = async (raw: string, opts: { fromLegacy?: boolean } = {}) => {
    setAdding(true)
    setAddError(null)
    try {
      const key = await addAiKey(raw)
      replaceKey(key)
      toast.success(`${AI_PROVIDER_LABEL[key.provider]} key added`, {
        description: `Checked with ${key.defaultModel}. It now works on every device you sign in to.`,
      })
      if (opts.fromLegacy) {
        new SettingsService().forgetLegacyAnthropicKey()
        setLegacyKey(null)
      } else {
        setDraft('')
      }
      loadUsage()
    } catch (err) {
      setAddError(errorText(err))
    } finally {
      setAdding(false)
    }
  }

  const detection = detectKeyProvider(draft)
  const canSubmit = draft.trim().length > 0 && !adding && !(detection.provider === null && detection.reason)

  const onModelChange = async (key: AiKey, value: string) => {
    setBusyKeyId(key.id)
    try {
      replaceKey(await setAiKeyModel(key.id, value === '' ? null : value))
    } catch (err) {
      toast.error('Could not change the model', { description: errorText(err) })
    } finally {
      setBusyKeyId(null)
    }
  }

  const onRecheck = async (key: AiKey) => {
    setBusyKeyId(key.id)
    try {
      const next = await recheckAiKey(key.id)
      replaceKey(next)
      if (next.status === 'ok') toast.success(`${AI_PROVIDER_LABEL[next.provider]} key works`)
      else toast.error(`${AI_PROVIDER_LABEL[next.provider]} key still fails`, { description: next.lastError ?? undefined })
      loadUsage()
    } catch (err) {
      toast.error('Could not check the key', { description: errorText(err) })
    } finally {
      setBusyKeyId(null)
    }
  }

  const onRemove = async (key: AiKey) => {
    if (!window.confirm(`Remove your ${AI_PROVIDER_LABEL[key.provider]} key (…${key.keyHint})? AI features that need it stop working until you add a key again.`)) return
    setBusyKeyId(key.id)
    try {
      await removeAiKey(key.id)
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== key.id))
      if (settings.preferredProvider === key.provider) setSettings({ preferredProvider: null })
    } catch (err) {
      toast.error('Could not remove the key', { description: errorText(err) })
    } finally {
      setBusyKeyId(null)
    }
  }

  const onPreferredProvider = async (value: string) => {
    const previous = settings
    const preferredProvider = value === '' ? null : (value as AiProvider)
    setSettings({ preferredProvider })
    try {
      setSettings(await saveAiSettings({ preferredProvider }))
    } catch (err) {
      setSettings(previous)
      toast.error('Could not save', { description: errorText(err) })
    }
  }

  if (loadError) {
    return (
      <div className="mt-4 space-y-3">
        <p className="text-sm text-destructive">Could not load your AI keys. {loadError}</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </div>
    )
  }

  const workingKeys = (keys ?? []).filter((k) => k.status === 'ok')
  const noVision = workingKeys.length > 0 && workingKeys.every((k) => k.imageModels.length === 0)

  return (
    <div className="mt-4 space-y-10">
      <section className="space-y-6">
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
          Nibbler runs every AI feature (translations, explanations, scanned-page text, AI Suggest) on your own
          provider key. Paste a key from Anthropic, OpenAI, Google Gemini or xAI and Nibbler works out which one it
          is, checks it with one tiny request, then stores it encrypted with your account so it works on every
          device you sign in to. Your provider bills you directly.
        </p>

        {legacyKey && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
            <p className="font-medium">An Anthropic key is still saved in this browser</p>
            <p className="mt-1 text-muted-foreground">
              Earlier versions kept it here. Move it to your account so every device can use it, or remove it.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={adding} onClick={() => submitKey(legacyKey, { fromLegacy: true })}>
                {adding ? 'Checking…' : 'Move to my account'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={adding}
                onClick={() => {
                  new SettingsService().forgetLegacyAnthropicKey()
                  setLegacyKey(null)
                }}
              >
                Remove from this browser
              </Button>
            </div>
          </div>
        )}

        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSubmit) submitKey(draft)
          }}
        >
          <Label htmlFor="ai-key">Add a key</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…, sk-…, AIza… or xai-…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setAddError(null)
              }}
              aria-describedby="ai-key-hint"
            />
            <Button type="submit" disabled={!canSubmit} className="shrink-0">
              <KeyRoundIcon aria-hidden="true" />
              {adding ? 'Checking…' : 'Add key'}
            </Button>
          </div>
          <p id="ai-key-hint" className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
            {addError ? (
              <span className="text-destructive">{addError}</span>
            ) : detection.provider ? (
              adding ? `Checking with ${AI_PROVIDER_LABEL[detection.provider]}…` : `${AI_PROVIDER_LABEL[detection.provider]} key detected.`
            ) : detection.reason ? (
              <span className="text-destructive">{detection.reason}</span>
            ) : (
              'One key per provider: adding a second key for the same provider replaces the first.'
            )}
          </p>
        </form>
      </section>

      <section className="space-y-3" aria-labelledby="ai-keys-heading">
        <h2 id="ai-keys-heading" className="text-sm font-semibold">Your keys</h2>
        {keys === null ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-24 animate-pulse rounded-lg bg-muted/50" />
          </div>
        ) : keys.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            No keys yet. Until you add one, translations, explanations, scanned-page text and AI Suggest are off.
            Gemini has a free tier if you just want to try it.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {keys.map((key) => (
              <KeyRow
                key={key.id}
                aiKey={key}
                busy={busyKeyId === key.id}
                onModelChange={(v) => onModelChange(key, v)}
                onRecheck={() => onRecheck(key)}
                onRemove={() => onRemove(key)}
              />
            ))}
          </ul>
        )}
        {noVision && (
          <p className="text-xs text-muted-foreground">
            None of your working keys can read page images, so scanned-page text, figure explanations and AI Suggest
            for contents won&apos;t run. Add a Gemini, OpenAI or Anthropic key for those.
          </p>
        )}

        {keys && keys.length > 1 && (
          <div className="max-w-sm space-y-2 pt-2">
            <Label htmlFor="ai-preferred-provider">Try first</Label>
            <select
              id="ai-preferred-provider"
              className={SELECT_CLASS}
              value={settings.preferredProvider ?? ''}
              onChange={(e) => onPreferredProvider(e.target.value)}
            >
              <option value="">In the order I added them</option>
              {keys.map((k) => (
                <option key={k.provider} value={k.provider}>{AI_PROVIDER_LABEL[k.provider]}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              If that key fails or runs out of credit, Nibbler moves on to your next key.
            </p>
          </div>
        )}
      </section>

      <UsageSection usage={usage} />
    </div>
  )
}

function KeyRow({
  aiKey,
  busy,
  onModelChange,
  onRecheck,
  onRemove,
}: {
  aiKey: AiKey
  busy: boolean
  onModelChange: (value: string) => void
  onRecheck: () => void
  onRemove: () => void
}) {
  const label = AI_PROVIDER_LABEL[aiKey.provider] ?? aiKey.provider
  const ok = aiKey.status === 'ok'
  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted-foreground">••••{aiKey.keyHint}</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            ok ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
          }`}
        >
          {ok ? 'Working' : 'Not working'}
        </span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="xs" disabled={busy} onClick={onRecheck}>
            <RefreshCwIcon aria-hidden="true" className={busy ? 'animate-spin' : undefined} />
            Check again
          </Button>
          <Button variant="ghost" size="xs" disabled={busy} onClick={onRemove} aria-label={`Remove ${label} key`}>
            <Trash2Icon aria-hidden="true" />
            Remove
          </Button>
        </span>
      </div>

      {!ok && aiKey.lastError && <p className="text-xs text-destructive">{aiKey.lastError}</p>}

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor={`ai-model-${aiKey.id}`} className="text-xs text-muted-foreground">Model</Label>
          <select
            id={`ai-model-${aiKey.id}`}
            className={SELECT_CLASS}
            value={aiKey.preferredModel ?? ''}
            disabled={busy}
            onChange={(e) => onModelChange(e.target.value)}
          >
            <option value="">Cheapest that works ({aiKey.defaultModel})</option>
            {aiKey.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground sm:pb-2.5">
          {aiKey.imageModels.length > 0 ? 'Reads page images' : 'Text only'}
        </p>
      </div>
    </li>
  )
}

function UsageSection({ usage }: { usage: AiUsage | null }) {
  return (
    <section className="space-y-4" aria-labelledby="ai-usage-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="ai-usage-heading" className="text-sm font-semibold">Usage, last 30 days</h2>
        <span className="text-xs text-muted-foreground">Estimated from list prices</span>
      </div>
      {usage === null ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted/50" aria-busy="true" />
      ) : usage.totals.calls === 0 ? (
        <p className="text-sm text-muted-foreground">No AI calls yet.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="Spent" value={formatUsd(usage.totals.costMicroUsd)} />
            <Stat label="Calls" value={formatCount(usage.totals.calls)} />
            <Stat label="Tokens in" value={formatCount(usage.totals.inputTokens)} />
            <Stat label="Tokens out" value={formatCount(usage.totals.outputTokens)} />
          </dl>
          <div className="grid gap-6 sm:grid-cols-2">
            <UsageTable
              caption="By feature"
              rows={usage.byFeature.map((r) => ({
                key: r.feature,
                name: FEATURE_LABEL[r.feature] ?? r.feature,
                calls: r.calls,
                cost: r.costMicroUsd,
              }))}
            />
            <UsageTable
              caption="By model"
              rows={usage.byModel.map((r) => ({
                key: `${r.provider}/${r.model}`,
                name: r.model,
                calls: r.calls,
                cost: r.costMicroUsd,
              }))}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Your provider&apos;s own billing page is the exact figure.
          </p>
        </>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg tabular-nums">{value}</dd>
    </div>
  )
}

function UsageTable({ caption, rows }: { caption: string; rows: Array<{ key: string; name: string; calls: number; cost: number }> }) {
  return (
    // table-fixed + colgroup: the name column takes what the numbers leave, and
    // only a genuinely long model id is cut short (its full name is the title).
    <table className="w-full table-fixed text-sm">
      <caption className="mb-1 text-left text-xs font-medium text-muted-foreground">{caption}</caption>
      <colgroup>
        <col />
        <col className="w-12" />
        <col className="w-20" />
      </colgroup>
      <thead className="sr-only">
        <tr><th>Name</th><th>Calls</th><th>Cost</th></tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="truncate py-1.5 pr-3" title={r.name}>{r.name}</td>
            <td className="py-1.5 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatCount(r.calls)}</td>
            <td className="py-1.5 text-right font-mono text-xs tabular-nums">{formatUsd(r.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
