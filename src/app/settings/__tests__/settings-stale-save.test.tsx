import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The General form holds a snapshot of bbb-settings taken at mount. Its Save
// must write only the fields edited in the form, so a value changed meanwhile
// in another tab or pulled from another device survives (KAN-417). Uses the
// real SettingsService over jsdom localStorage.

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=general'),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test', role: 'user' } } }),
}))

vi.mock('@/components/auth/user-menu', () => ({ UserMenu: () => null }))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

// updateSettings schedules a push through the sync layer; not under test.
vi.mock('@/lib/services/sync-service', () => ({
  syncService: { markDirty: vi.fn() },
}))

vi.mock('@/components/settings/profile-settings', () => ({
  ProfileSettings: () => <div>profile panel body</div>,
}))
vi.mock('@/components/settings/keymap-settings', () => ({
  KeymapSettings: ({ overrides }: { overrides: Record<string, string> }) => (
    <div data-testid="keymap">{JSON.stringify(overrides)}</div>
  ),
}))
vi.mock('@/components/settings/cloud-sync-settings', () => ({
  CloudSyncSettings: () => <div>cloud panel body</div>,
}))
vi.mock('@/components/settings/admin-settings', () => ({
  AdminSettings: () => <div>admin panel body</div>,
}))

import SettingsPage from '../page'

const KEY = 'bbb-settings'
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '{}')

/** Another tab, or a sync pull, rewrites stored settings under the form. */
function writeElsewhere(patch: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ ...stored(), ...patch }))
}

const saveButton = () => screen.getByRole('button', { name: /Save Settings|Saved!/ })
const language = () => screen.getByLabelText('Translation language') as HTMLSelectElement

async function renderSettings() {
  render(<SettingsPage />)
  await screen.findByLabelText('Translation language')
}

describe('General Save writes only the fields edited in the form (KAN-417)', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(KEY, JSON.stringify({
      targetLanguage: 'zh',
      defaultViewMode: 'pdf',
      readingMode: 'scroll',
      keymapOverrides: {},
    }))
  })

  it('keeps a keymap remap made elsewhere after the form loaded', async () => {
    await renderSettings()
    writeElsewhere({ keymapOverrides: { 'next-page': 'Shift+n' } })

    fireEvent.change(language(), { target: { value: 'es' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(stored().targetLanguage).toBe('es'))
    expect(stored().keymapOverrides).toEqual({ 'next-page': 'Shift+n' })
  })

  it('keeps other General fields changed elsewhere that the user did not touch', async () => {
    await renderSettings()
    writeElsewhere({ readingMode: 'flip', defaultViewMode: 'text' })

    fireEvent.change(language(), { target: { value: 'es' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(stored().targetLanguage).toBe('es'))
    expect(stored().readingMode).toBe('flip')
    expect(stored().defaultViewMode).toBe('text')
  })

  it('an edit made in the form still wins over the same field changed elsewhere', async () => {
    await renderSettings()
    fireEvent.change(language(), { target: { value: 'es' } })
    writeElsewhere({ targetLanguage: 'zh', readingMode: 'flip' })

    fireEvent.click(saveButton())

    await waitFor(() => expect(stored().targetLanguage).toBe('es'))
    expect(stored().readingMode).toBe('flip')
  })

  it('adopts another tab\'s change on the storage event, keeping an unsaved edit', async () => {
    await renderSettings()
    fireEvent.click(screen.getByRole('radio', { name: 'Flip' }))

    writeElsewhere({ targetLanguage: 'es', readingMode: 'scroll', keymapOverrides: { 'next-page': 'Shift+n' } })
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: KEY })) })

    await waitFor(() => expect(language().value).toBe('es'))
    // The unsaved Flip edit is not overwritten by the other tab's Scroll.
    expect(screen.getByRole('radio', { name: 'Flip' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Keymap' }), { button: 0 })
    expect(screen.getByTestId('keymap').textContent).toBe('{"next-page":"Shift+n"}')
  })

  it('adopts a pulled value on the synced event while an edit is pending', async () => {
    await renderSettings()
    fireEvent.click(screen.getByRole('radio', { name: 'Flip' }))

    writeElsewhere({ targetLanguage: 'es' })
    act(() => { window.dispatchEvent(new Event('bbb-settings-synced')) })

    await waitFor(() => expect(language().value).toBe('es'))
    expect(screen.getByRole('radio', { name: 'Flip' }).getAttribute('aria-checked')).toBe('true')
  })
})
