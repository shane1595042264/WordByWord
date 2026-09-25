import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { AppSettings } from '@/lib/services/settings-service'

// The page reads ?tab= through useSearchParams and writes it back through
// router.replace. Both are driven by hand here so a query-only navigation can
// be replayed WITHOUT unmounting — which is exactly what App Router does on a
// soft navigation, and what the defaultValue bug (KAN-326) hid behind.
let currentParams = new URLSearchParams()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentParams,
  useRouter: () => ({ replace, push: vi.fn() }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test', role: 'user' } } }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

const SETTINGS: AppSettings = {
  anthropicApiKey: null,
  autoReadThresholdSeconds: 30,
  defaultViewMode: 'pdf',
  trackingMode: 'timer',
  readingMode: 'scroll',
  keymapOverrides: {},
  targetLanguage: 'zh',
  warnBeforeSync: true,
}

// The page statically imports TARGET_LANGUAGES/SETTINGS_SYNCED_EVENT and
// dynamically imports SettingsService; one mock covers both.
vi.mock('@/lib/services/settings-service', () => ({
  SETTINGS_SYNCED_EVENT: 'bbb-settings-synced',
  TARGET_LANGUAGES: [{ code: 'zh', label: 'Chinese', native: '中文' }],
  SettingsService: class {
    getSettings() { return SETTINGS }
    updateSettings() {}
  },
}))

// Panel bodies are irrelevant to tab switching and drag in IndexedDB/network.
vi.mock('@/components/settings/profile-settings', () => ({
  ProfileSettings: () => <div>profile panel body</div>,
}))
vi.mock('@/components/settings/keymap-settings', () => ({
  KeymapSettings: () => <div>keymap panel body</div>,
}))
vi.mock('@/components/settings/cloud-sync-settings', () => ({
  CloudSyncSettings: () => <div>cloud panel body</div>,
}))
vi.mock('@/components/settings/admin-settings', () => ({
  AdminSettings: () => <div>admin panel body</div>,
}))

import SettingsPage from '../page'

const tab = (name: string) => screen.getByRole('tab', { name })

/** The settings body arrives behind a dynamic import, so wait for a real tab. */
async function renderSettings() {
  const utils = render(<SettingsPage />)
  await screen.findByRole('tab', { name: 'Profile' })
  return utils
}

describe('Settings tabs follow ?tab= (KAN-326)', () => {
  beforeEach(() => {
    currentParams = new URLSearchParams()
    replace.mockClear()
  })

  it('moves the active panel when ?tab= changes without remounting', async () => {
    const { rerender } = await renderSettings()

    expect(tab('Profile').getAttribute('data-state')).toBe('active')
    expect(tab('Keymap').getAttribute('data-state')).toBe('inactive')

    // What Ctrl+] does: a query-only push. Same component instance, new param.
    currentParams = new URLSearchParams('tab=keymap')
    rerender(<SettingsPage />)

    expect(tab('Keymap').getAttribute('data-state')).toBe('active')
    expect(tab('Profile').getAttribute('data-state')).toBe('inactive')
    expect(screen.getByText('keymap panel body')).toBeDefined()
  })

  it('honours a cold deep link to a non-default tab', async () => {
    currentParams = new URLSearchParams('tab=cloud')
    await renderSettings()

    expect(tab('Cloud Sync').getAttribute('data-state')).toBe('active')
    expect(screen.getByText('cloud panel body')).toBeDefined()
  })

  it('falls back to Profile for an unknown ?tab=', async () => {
    currentParams = new URLSearchParams('tab=bogus')
    await renderSettings()

    expect(tab('Profile').getAttribute('data-state')).toBe('active')
  })

  it('writes the selection back to the URL so the page stays deep-linkable', async () => {
    await renderSettings()

    // Radix activates a trigger on mousedown, not click.
    fireEvent.mouseDown(tab('Keymap'), { button: 0, ctrlKey: false })

    expect(tab('Keymap').getAttribute('data-state')).toBe('active')
    // replace, not push — clicking through tabs must not pollute history.
    expect(replace).toHaveBeenCalledWith('/settings?tab=keymap', { scroll: false })
  })
})
