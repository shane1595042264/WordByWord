'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { toast } from 'sonner'
import { ArrowLeftIcon } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { KeymapSettings } from '@/components/settings/keymap-settings'
import { AdminSettings } from '@/components/settings/admin-settings'
import { CloudSyncSettings } from '@/components/settings/cloud-sync-settings'
import { ProfileSettings } from '@/components/settings/profile-settings'
import { AiKeysSettings } from '@/components/settings/ai-keys-settings'
import type { AppSettings } from '@/lib/services/settings-service'
import { TARGET_LANGUAGES, SETTINGS_KEY, SETTINGS_SYNCED_EVENT } from '@/lib/services/settings-service'
import { reportLazyImportError } from '@/lib/lazy-import-error'

function SettingsContent() {
  const { data: session } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tabParam = searchParams.get('tab')
  const urlTab = tabParam && ['profile', 'general', 'ai', 'keymap', 'cloud', 'admin'].includes(tabParam)
    ? tabParam
    : 'profile'
  const isAdmin = (session?.user as any)?.role === 'admin'
  // The Tabs root is controlled, not defaultValue-seeded: a query-only push
  // (Ctrl+], back/forward, a deep link) is a soft navigation that re-renders
  // this client component without remounting it, so Radix would never read a
  // fresh defaultValue and the panel would sit still while the URL moved.
  const [activeTab, setActiveTab] = useState(urlTab)

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [saved, setSaved] = useState(false)
  // Tracks edits made in this form that Save hasn't persisted yet.
  const [unsavedEdits, setUnsavedEdits] = useState(false)
  // Exactly the fields the user changed here since the last load or Save. Save
  // persists only these: `settings` is a snapshot, and writing it whole would
  // revert anything changed meanwhile in another tab or pulled from another
  // device, e.g. a keymap remap (KAN-417). A ref so an async re-read always
  // overlays the latest edits.
  const pendingEdits = useRef<Partial<AppSettings>>({})

  /** Every form control writes through here so Save and a re-read know what this form owns. */
  const editSettings = (patch: Partial<AppSettings>) => {
    pendingEdits.current = { ...pendingEdits.current, ...patch }
    setUnsavedEdits(true)
    setSettings(prev => prev && { ...prev, ...patch })
  }

  /**
   * Write the selection back so ?tab= stays truthful and /settings is
   * deep-linkable. replace, not push, so clicking through tabs doesn't fill
   * history; scroll:false so the page doesn't jump to the top on each switch.
   */
  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    router.replace(`/settings?tab=${tab}`, { scroll: false })
  }

  // Adopt any externally-driven ?tab= change.
  useEffect(() => {
    setActiveTab(urlTab)
  }, [urlTab])

  useEffect(() => {
    let cancelled = false
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      if (cancelled) return
      const svc = new SettingsService()
      setSettings(svc.getSettings())
    }, (err) => {
      // Import rejected (e.g. stale chunk after a deploy) — without this the page
      // is stuck on 'Loading...' forever because `settings` stays null.
      if (cancelled) return
      setLoadError(true)
      reportLazyImportError('settings page load', err)
    })
    return () => { cancelled = true }
  }, [])

  // Stored settings changed under this form: a sync pulled them from another
  // device, or another tab saved them. This form's state is a snapshot from
  // mount, so adopt the stored values — except for fields with an unsaved edit
  // here, which win and get pushed on Save, matching the same dirty-wins rule
  // the sync layer uses (KAN-288).
  useEffect(() => {
    const adopt = () => {
      import('@/lib/services/settings-service').then(({ SettingsService }) => {
        setSettings({ ...new SettingsService().getSettings(), ...pendingEdits.current })
      }, (err) => reportLazyImportError('settings page sync refresh', err))
    }
    // key is null when another tab cleared localStorage entirely.
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY || e.key === null) adopt()
    }
    window.addEventListener(SETTINGS_SYNCED_EVENT, adopt)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SETTINGS_SYNCED_EVENT, adopt)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // General is a deferred-save form: nothing is persisted until Save. Without a
  // guard a reload or tab close drops the edits silently (KAN-331). Same
  // pattern as upload-dialog.tsx. (AI keys are no longer part of this form:
  // the AI tab saves each key to the account the moment it is added.)
  useEffect(() => {
    if (!unsavedEdits) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [unsavedEdits])

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-4">
        <p className="text-muted-foreground max-w-md">
          Could not load your settings. This usually happens after the app updates while a tab was open.
        </p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }

  if (!settings) {
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  const handleSave = async () => {
    const { SettingsService } = await import('@/lib/services/settings-service')
    const svc = new SettingsService()
    try {
      svc.updateSettings(pendingEdits.current)
      pendingEdits.current = {}
      setSettings(svc.getSettings())
      setUnsavedEdits(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      toast.error('Failed to save settings', {
        description: err instanceof Error ? err.message : 'Unknown storage error.',
        duration: 5000,
      })
    }
  }

  // Links stay Links for prefetch and middle-click, but a soft navigation
  // unmounts this form without firing beforeunload, so the dirty check has to
  // be done on every in-app link out of here too (KAN-331): Back to Library
  // and the header's brand and Library links.
  const guardLeave = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!unsavedEdits) return
    // A modified click opens a new tab/window — this form is not going
    // anywhere, so there is nothing to guard.
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    if (window.confirm('You have unsaved settings changes. Leave without saving?')) {
      pendingEdits.current = {}
      setUnsavedEdits(false)
      router.push(href)
    }
  }

  return (
    <div className="min-h-[100dvh]">
    <AppHeader onInternalLinkClick={guardLeave} />
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6">
      <Link
        href="/"
        onClick={(e) => guardLeave(e, '/')}
        className="mb-8 inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        Back to Library
      </Link>
      <h1 className="mb-8 font-display text-4xl font-semibold tracking-tight md:text-5xl">Settings</h1>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="keymap">Keymap</TabsTrigger>
          <TabsTrigger value="cloud">Cloud Sync</TabsTrigger>
          {isAdmin && <TabsTrigger value="admin">Admin</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="general">
          <div className="space-y-6 mt-4">
            <div className="space-y-2">
              <Label id="default-view-mode-label">Default view mode</Label>
              <div className="flex gap-2" role="radiogroup" aria-labelledby="default-view-mode-label">
                {(['pdf', 'text', 'side-by-side'] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={settings.defaultViewMode === mode ? 'default' : 'outline'}
                    size="sm"
                    role="radio"
                    aria-checked={settings.defaultViewMode === mode}
                    onClick={() => editSettings({ defaultViewMode: mode })}
                    className="capitalize"
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target-language">Translation language</Label>
              <select
                id="target-language"
                className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
                value={settings.targetLanguage}
                onChange={e => editSettings({ targetLanguage: e.target.value as any })}
              >
                {TARGET_LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.label} ({lang.native})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Words will be translated to this language when you select them.
              </p>
            </div>

            <div className="space-y-2">
              <Label id="reading-mode-label">Default reading mode</Label>
              <div className="flex gap-2" role="radiogroup" aria-labelledby="reading-mode-label">
                <Button
                  variant={settings.readingMode === 'scroll' ? 'default' : 'outline'}
                  size="sm"
                  role="radio"
                  aria-checked={settings.readingMode === 'scroll'}
                  onClick={() => editSettings({ readingMode: 'scroll' })}
                >
                  Scroll
                </Button>
                <Button
                  variant={settings.readingMode === 'flip' ? 'default' : 'outline'}
                  size="sm"
                  role="radio"
                  aria-checked={settings.readingMode === 'flip'}
                  onClick={() => editSettings({ readingMode: 'flip' })}
                >
                  Flip
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Scroll: all pages in a continuous scroll. Flip: one page at a time with keyboard navigation (arrow keys / spacebar).
              </p>
            </div>

            <div className="space-y-2">
              <Label>Sync behavior</Label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.warnBeforeSync}
                  aria-labelledby="warn-before-sync-label"
                  onClick={() => editSettings({ warnBeforeSync: !settings.warnBeforeSync })}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    settings.warnBeforeSync ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    settings.warnBeforeSync ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
                <span id="warn-before-sync-label" className="text-sm">Warn before sync</span>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, you&apos;ll be asked before cloud changes are applied (e.g. deletions from another device).
                When disabled, sync happens automatically with recency bias — most recent change wins.
              </p>
            </div>

            {/* Deferred save, so the button is the only cue that edits are
                pending — disabled when clean, marked when dirty (KAN-331). */}
            <Button onClick={handleSave} disabled={!unsavedEdits}>
              {saved ? 'Saved!' : unsavedEdits ? 'Save Settings *' : 'Save Settings'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="ai">
          <AiKeysSettings />
        </TabsContent>

        <TabsContent value="cloud">
          <div className="mt-4">
            <CloudSyncSettings />
          </div>
        </TabsContent>

        <TabsContent value="keymap">
          <div className="mt-4">
            <KeymapSettings
              overrides={settings.keymapOverrides ?? {}}
              onChange={(overrides) => {
                setSettings(prev => prev && { ...prev, keymapOverrides: overrides })
                // Auto-save keymap changes. Persist ONLY the key this tab owns:
                // `settings` may still carry unconfirmed General edits, and
                // updateSettings merges the partial over the stored copy, so
                // passing the whole object would commit — and sync — values the
                // user never clicked Save on (KAN-331).
                import('@/lib/services/settings-service').then(({ SettingsService }) => {
                  const svc = new SettingsService()
                  svc.updateSettings({ keymapOverrides: overrides })
                  window.dispatchEvent(new Event('keymap-changed'))
                }).catch((err) => {
                  toast.error('Failed to save keymap', {
                    description: err instanceof Error ? err.message : 'Unknown storage error.',
                    duration: 5000,
                  })
                })
              }}
            />
          </div>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="admin">
            <div className="mt-4">
              <AdminSettings />
            </div>
          </TabsContent>
        )}
      </Tabs>
    </main>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20 text-muted-foreground" aria-busy="true">Loading...</div>}>
      <SettingsContent />
    </Suspense>
  )
}
