'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { KeymapSettings } from '@/components/settings/keymap-settings'
import type { AppSettings } from '@/lib/services/settings-service'

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Dynamic import to avoid SSR issues
  if (!loaded) {
    import('@/lib/services/settings-service').then(({ SettingsService }) => {
      const svc = new SettingsService()
      setSettings(svc.getSettings())
      setLoaded(true)
    })
    return <div className="flex justify-center py-20 text-muted-foreground">Loading...</div>
  }

  if (!settings) return null

  const handleSave = async () => {
    const { SettingsService } = await import('@/lib/services/settings-service')
    const svc = new SettingsService()
    svc.updateSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <Link href="/" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">
        &larr; Back to Library
      </Link>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="keymap">Keymap</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="space-y-6 mt-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">Anthropic API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="sk-ant-..."
                value={settings.anthropicApiKey ?? ''}
                onChange={e => setSettings({ ...settings, anthropicApiKey: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">
                Required for AI-powered section splitting. Your key stays in your browser.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Reading tracking mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={settings.trackingMode === 'timer' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings({ ...settings, trackingMode: 'timer' })}
                >
                  Timer
                </Button>
                <Button
                  variant={settings.trackingMode === 'endofpage' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings({ ...settings, trackingMode: 'endofpage' })}
                >
                  End of Page
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Timer: marks as read after a set time. End of Page: marks as read when you scroll to the bottom.
              </p>
            </div>

            {settings.trackingMode === 'timer' && (
              <div className="space-y-2">
                <Label>Auto-read threshold: {settings.autoReadThresholdSeconds}s</Label>
                <Slider
                  value={[settings.autoReadThresholdSeconds]}
                  onValueChange={([v]) => setSettings({ ...settings, autoReadThresholdSeconds: v })}
                  min={1}
                  max={30}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  Sections are marked as read after viewing for this many seconds.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Default view mode</Label>
              <div className="flex gap-2">
                {(['pdf', 'text', 'side-by-side'] as const).map(mode => (
                  <Button
                    key={mode}
                    variant={settings.defaultViewMode === mode ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSettings({ ...settings, defaultViewMode: mode })}
                    className="capitalize"
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Default reading mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={settings.readingMode === 'scroll' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings({ ...settings, readingMode: 'scroll' })}
                >
                  Scroll
                </Button>
                <Button
                  variant={settings.readingMode === 'flip' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSettings({ ...settings, readingMode: 'flip' })}
                >
                  Flip
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Scroll: all pages in a continuous scroll. Flip: one page at a time with keyboard navigation (arrow keys / spacebar).
              </p>
            </div>

            <Button onClick={handleSave}>
              {saved ? 'Saved!' : 'Save Settings'}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="keymap">
          <div className="mt-4">
            <KeymapSettings
              overrides={settings.keymapOverrides ?? {}}
              onChange={(overrides) => {
                const updated = { ...settings, keymapOverrides: overrides }
                setSettings(updated)
                // Auto-save keymap changes
                import('@/lib/services/settings-service').then(({ SettingsService }) => {
                  const svc = new SettingsService()
                  svc.updateSettings(updated)
                })
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
