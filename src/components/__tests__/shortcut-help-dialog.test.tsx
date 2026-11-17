import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <a href={href} onClick={onClick} className={className}>{children}</a>
  ),
}))

// Stable like the real router: a fresh object per render re-registers every
// shortcut on every render, which loops.
const router = vi.hoisted(() => ({ push: () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/',
}))

const aiMock = vi.hoisted(() => ({ searchShortcutsWithAi: vi.fn() }))
vi.mock('@/lib/services/ai-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/ai-api')>()),
  ...aiMock,
}))

const { ShortcutHelpDialog } = await import('@/components/shortcut-help-dialog')
const { AiApiError } = await import('@/lib/services/ai-api')
const { buildShortcutCatalog, matchShortcuts } = await import('@/lib/shortcut-catalog')
const { ShortcutProvider } = await import('@/hooks/use-shortcuts')
const { GlobalNavigationShortcuts } = await import('@/components/global-navigation-shortcuts')

function renderOpen() {
  return render(<ShortcutHelpDialog open onOpenChange={() => {}} />)
}

const search = () => screen.getByLabelText('Search shortcuts') as HTMLInputElement

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('shortcut catalog', () => {
  it('lists global shortcuts and vim rules with the keys they fire on now', () => {
    const catalog = buildShortcutCatalog({ 'toggle-sidebar': 'Ctrl+k', 'normal:s': 'x' })
    expect(catalog.find(e => e.id === 'toggle-sidebar')).toMatchObject({ keys: 'Ctrl+k', scope: 'Global' })
    expect(catalog.find(e => e.id === 'normal:s')).toMatchObject({ keys: 'x', scope: 'Normal' })
    expect(catalog.find(e => e.id === 'view-pdf')?.keys).toBe('Ctrl+1')
    expect(catalog.find(e => e.id === 'shortcut-help')?.keys).toBe('Shift+?')
  })

  it('matches every query word anywhere in the entry, not the query as one string', () => {
    const catalog = buildShortcutCatalog({})
    expect(matchShortcuts(catalog, 'toggle sidebar').map(e => e.id)).toEqual(['toggle-sidebar'])
    expect(matchShortcuts(catalog, 'how do i switch to different modes')).toEqual([])
    expect(matchShortcuts(catalog, '   ')).toHaveLength(catalog.length)
  })
})

describe('ShortcutHelpDialog', () => {
  it('shows the remapped key, not the default', () => {
    localStorage.setItem('bbb-settings', JSON.stringify({ keymapOverrides: { 'toggle-sidebar': 'Ctrl+k' } }))
    renderOpen()
    fireEvent.change(search(), { target: { value: 'sidebar' } })
    expect(screen.getByText('Toggle Sections Panel')).toBeTruthy()
    expect(screen.getByText('Ctrl+k')).toBeTruthy()
    expect(screen.queryByText('Ask AI')).toBeNull()
  })

  it('never calls the AI while words still match', () => {
    renderOpen()
    fireEvent.change(search(), { target: { value: 'sidebar' } })
    fireEvent.keyDown(search(), { key: 'Enter' })
    expect(aiMock.searchShortcutsWithAi).not.toHaveBeenCalled()
  })

  it('asks the AI on Enter when nothing matches and lists what it picked', async () => {
    aiMock.searchShortcutsWithAi.mockResolvedValue(['normal:s', 'view-pdf'])
    renderOpen()
    fireEvent.change(search(), { target: { value: 'how do I switch modes' } })
    expect(screen.getByText('Ask AI')).toBeTruthy()
    fireEvent.keyDown(search(), { key: 'Enter' })

    await waitFor(() => expect(screen.getByText('Enter Sentence mode')).toBeTruthy())
    expect(screen.getByText('PDF View')).toBeTruthy()
    const [query, sent] = aiMock.searchShortcutsWithAi.mock.calls[0]
    expect(query).toBe('how do I switch modes')
    expect(sent.find((s: { id: string }) => s.id === 'normal:s').description).toMatch(/Normal mode/)
  })

  it('links to Settings > AI when the reader has no key', async () => {
    aiMock.searchShortcutsWithAi.mockRejectedValue(
      new AiApiError('Add your own AI key in Settings > AI to use this.', 409, 'AI_KEY_REQUIRED'),
    )
    renderOpen()
    fireEvent.change(search(), { target: { value: 'zzz qqq' } })
    fireEvent.click(screen.getByText('Ask AI'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Add your own AI key/))
    expect(screen.getByText('Open AI settings').getAttribute('href')).toBe('/settings?tab=ai')
  })

  it('drops an AI answer that lands after the query changed', async () => {
    let resolve!: (ids: string[]) => void
    aiMock.searchShortcutsWithAi.mockReturnValue(new Promise<string[]>(r => { resolve = r }))
    renderOpen()
    fireEvent.change(search(), { target: { value: 'zzz qqq' } })
    fireEvent.click(screen.getByText('Ask AI'))
    fireEvent.change(search(), { target: { value: 'zzz qqqq' } })
    resolve(['normal:s'])
    await new Promise(r => setTimeout(r, 0))
    expect(screen.queryByText('Enter Sentence mode')).toBeNull()
    expect(screen.getByText('Ask AI')).toBeTruthy()
  })
})

describe('? opens the dialog app-wide', () => {
  const pressQuestionMark = (target: EventTarget = window) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }))
    })

  it('opens on ?, and ? typed into the search box stays text', () => {
    render(<ShortcutProvider><GlobalNavigationShortcuts /></ShortcutProvider>)
    expect(screen.queryByLabelText('Search shortcuts')).toBeNull()

    pressQuestionMark()
    expect(screen.getByLabelText('Search shortcuts')).toBeTruthy()

    pressQuestionMark(search())
    expect(screen.getByLabelText('Search shortcuts')).toBeTruthy()
  })

  it('follows a remap made in Settings > Keymap', () => {
    localStorage.setItem('bbb-settings', JSON.stringify({ keymapOverrides: { 'shortcut-help': 'Ctrl+h' } }))
    render(<ShortcutProvider><GlobalNavigationShortcuts /></ShortcutProvider>)
    pressQuestionMark()
    expect(screen.queryByLabelText('Search shortcuts')).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(screen.getByLabelText('Search shortcuts')).toBeTruthy()
  })
})
