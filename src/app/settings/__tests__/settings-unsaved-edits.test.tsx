import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppSettings } from '@/lib/services/settings-service'

// General is a deferred-save form sharing one state object with the auto-saving
// Keymap tab. These cover both halves of KAN-331: the rebind must not commit
// General's pending edits, and leaving with pending edits must prompt.

// The General panel renders a Radix Slider, which measures itself; jsdom has
// no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('tab=general'),
  useRouter: () => ({ replace: vi.fn(), push }),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { name: 'Test', role: 'user' } } }),
}))

// Real next/link swallows onClick in jsdom; forward it so the exit guard runs.
vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}))

const STORED: AppSettings = {
  anthropicApiKey: null,
  autoReadThresholdSeconds: 30,
  defaultViewMode: 'pdf',
  trackingMode: 'timer',
  readingMode: 'scroll',
  keymapOverrides: {},
  targetLanguage: 'zh',
  warnBeforeSync: true,
}

const updateSettings = vi.fn()

vi.mock('@/lib/services/settings-service', () => ({
  SETTINGS_SYNCED_EVENT: 'bbb-settings-synced',
  TARGET_LANGUAGES: [
    { code: 'zh', label: 'Chinese', native: '中文' },
    { code: 'es', label: 'Spanish', native: 'Español' },
  ],
  SettingsService: class {
    getSettings() { return STORED }
    updateSettings(partial: Partial<AppSettings>) { updateSettings(partial) }
  },
}))

vi.mock('@/components/settings/profile-settings', () => ({
  ProfileSettings: () => <div>profile panel body</div>,
}))
// Stand-in for the real rebind UI: one button that reports a new override.
vi.mock('@/components/settings/keymap-settings', () => ({
  KeymapSettings: ({ onChange }: { onChange: (o: Record<string, string>) => void }) => (
    <button onClick={() => onChange({ 'prev-page': 'Shift+d' })}>rebind</button>
  ),
}))
vi.mock('@/components/settings/cloud-sync-settings', () => ({
  CloudSyncSettings: () => <div>cloud panel body</div>,
}))
vi.mock('@/components/settings/admin-settings', () => ({
  AdminSettings: () => <div>admin panel body</div>,
}))

import SettingsPage from '../page'

const saveButton = () => screen.getByRole('button', { name: /Save Settings|Saved!/ })

async function renderSettings() {
  const utils = render(<SettingsPage />)
  await screen.findByRole('tab', { name: 'Profile' })
  return utils
}

/** Make a General edit: pick a different translation language. */
function editGeneral() {
  fireEvent.change(screen.getByLabelText('Translation language'), { target: { value: 'es' } })
}

describe('Settings unsaved-edit handling (KAN-331)', () => {
  beforeEach(() => {
    push.mockClear()
    updateSettings.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('a keymap rebind persists only keymapOverrides, not a pending General edit', async () => {
    await renderSettings()
    editGeneral()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Keymap' }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'rebind' }))

    await waitFor(() => expect(updateSettings).toHaveBeenCalled())
    const partial = updateSettings.mock.calls[0][0]
    expect(partial).toEqual({ keymapOverrides: { 'prev-page': 'Shift+d' } })
    // The rejected General value must not ride along to localStorage or sync.
    expect('targetLanguage' in partial).toBe(false)
  })

  it('still auto-saves the rebind and fires keymap-changed', async () => {
    const onKeymapChanged = vi.fn()
    window.addEventListener('keymap-changed', onKeymapChanged)
    await renderSettings()

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Keymap' }), { button: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'rebind' }))

    await waitFor(() => expect(onKeymapChanged).toHaveBeenCalled())
    expect(updateSettings).toHaveBeenCalledWith({ keymapOverrides: { 'prev-page': 'Shift+d' } })
    window.removeEventListener('keymap-changed', onKeymapChanged)
  })

  it('surfaces the dirty state on the Save button', async () => {
    await renderSettings()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(saveButton().textContent).toBe('Save Settings')

    editGeneral()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)
    expect(saveButton().textContent).toBe('Save Settings *')

    fireEvent.click(saveButton())
    await waitFor(() => expect(updateSettings).toHaveBeenCalled())
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('confirms before Back to Library discards a pending edit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await renderSettings()

    const back = screen.getByRole('link', { name: /Back to Library/ })
    fireEvent.click(back)
    expect(confirm).not.toHaveBeenCalled()

    editGeneral()
    fireEvent.click(back)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(back)
    expect(push).toHaveBeenCalledWith('/')
  })

  it('registers a beforeunload guard only while edits are pending', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    await renderSettings()
    expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false)

    editGeneral()
    expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true)

    fireEvent.click(saveButton())
    await waitFor(() => expect(remove.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true))
  })
})
