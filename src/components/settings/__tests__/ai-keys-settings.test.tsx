import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// Settings > AI (BYOK, 2026-11-17): the reader pastes a provider key, nibble-api
// detects and checks it, and stores it encrypted against the account.

const api = vi.hoisted(() => ({
  fetchAiKeys: vi.fn(),
  fetchAiUsage: vi.fn(),
  addAiKey: vi.fn(),
  setAiKeyModel: vi.fn(),
  recheckAiKey: vi.fn(),
  removeAiKey: vi.fn(),
  saveAiSettings: vi.fn(),
}))
vi.mock('@/lib/services/ai-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/ai-api')>()),
  ...api,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { AiKeysSettings, formatUsd } = await import('../ai-keys-settings')
type AiKey = import('@/lib/services/ai-api').AiKey

const gemini: AiKey = {
  id: 'k-gem',
  provider: 'gemini',
  keyHint: 'WXYZ',
  models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  imageModels: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  defaultModel: 'gemini-2.5-flash-lite',
  preferredModel: null,
  status: 'ok',
  lastError: null,
  lastCheckedAt: '2026-11-17T10:00:00Z',
  createdAt: '2026-11-17T10:00:00Z',
}

const emptyUsage = {
  days: 30,
  totals: { calls: 0, inputTokens: 0, outputTokens: 0, costMicroUsd: 0 },
  byModel: [],
  byFeature: [],
  daily: [],
  recent: [],
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  api.fetchAiUsage.mockResolvedValue(emptyUsage)
})
afterEach(cleanup)

describe('AiKeysSettings', () => {
  it('with no key, says what is off and how to fix it', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    expect(await screen.findByText(/No keys yet/)).toBeTruthy()
  })

  it('names the provider as the reader pastes, and refuses a key it knows is unsupported', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    const input = await screen.findByLabelText('Add a key')
    const add = screen.getByRole('button', { name: /Add key/ }) as HTMLButtonElement

    fireEvent.change(input, { target: { value: 'sk-ant-api03-abc' } })
    expect(screen.getByText('Anthropic Claude key detected.')).toBeTruthy()
    expect(add.disabled).toBe(false)

    fireEvent.change(input, { target: { value: 'gsk_' + 'z'.repeat(40) } })
    expect(screen.getByText(/Groq is not supported/)).toBeTruthy()
    expect(add.disabled).toBe(true)
  })

  it('adds a key, lists it with its model choice, and clears the field', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    api.addAiKey.mockResolvedValue(gemini)
    render(<AiKeysSettings />)
    const input = (await screen.findByLabelText('Add a key')) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'AIza' + 'k'.repeat(35) } })
    fireEvent.click(screen.getByRole('button', { name: /Add key/ }))

    await waitFor(() => expect(api.addAiKey).toHaveBeenCalledWith('AIza' + 'k'.repeat(35)))
    expect(await screen.findByText('Google Gemini')).toBeTruthy()
    expect(screen.getByText('••••WXYZ')).toBeTruthy()
    expect(screen.getByText('Reads page images')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it("shows the server's reason when a key is refused", async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    api.addAiKey.mockRejectedValue(new Error('Your Anthropic account has no credit left.'))
    render(<AiKeysSettings />)
    fireEvent.change(await screen.findByLabelText('Add a key'), { target: { value: 'sk-ant-api03-' + 'w'.repeat(40) } })
    fireEvent.click(screen.getByRole('button', { name: /Add key/ }))
    expect(await screen.findByText('Your Anthropic account has no credit left.')).toBeTruthy()
  })

  it('picking a model saves it on that key', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [gemini], settings: { preferredProvider: null } })
    api.setAiKeyModel.mockResolvedValue({ ...gemini, preferredModel: 'gemini-2.5-flash' })
    render(<AiKeysSettings />)
    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement

    fireEvent.change(select, { target: { value: 'gemini-2.5-flash' } })

    await waitFor(() => expect(api.setAiKeyModel).toHaveBeenCalledWith('k-gem', 'gemini-2.5-flash'))
    await waitFor(() => expect(select.value).toBe('gemini-2.5-flash'))
  })

  it('offers to move a key the old General tab left in this browser, then forgets it', async () => {
    localStorage.setItem('bbb-settings', JSON.stringify({ anthropicApiKey: 'sk-ant-old-key-1234567890', readingMode: 'flip' }))
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    api.addAiKey.mockResolvedValue({ ...gemini, id: 'k-ant', provider: 'anthropic', keyHint: '7890' })
    render(<AiKeysSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Move to my account' }))

    await waitFor(() => expect(api.addAiKey).toHaveBeenCalledWith('sk-ant-old-key-1234567890'))
    await waitFor(() => expect(localStorage.getItem('bbb-settings')).not.toContain('anthropicApiKey'))
    expect(JSON.parse(localStorage.getItem('bbb-settings')!).readingMode).toBe('flip')
    expect(screen.queryByText(/still saved in this browser/)).toBeNull()
  })

  it('shows usage totals in dollars, keeping small costs readable', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [gemini], settings: { preferredProvider: null } })
    api.fetchAiUsage.mockResolvedValue({
      ...emptyUsage,
      totals: { calls: 12, inputTokens: 3400, outputTokens: 900, costMicroUsd: 4200 },
      byFeature: [{ feature: 'translate-word', calls: 12, costMicroUsd: 4200 }],
      byModel: [{ provider: 'gemini', model: 'gemini-2.5-flash-lite', calls: 12, inputTokens: 3400, outputTokens: 900, costMicroUsd: 4200 }],
    })
    render(<AiKeysSettings />)
    expect(await screen.findByText('Word translations')).toBeTruthy()
    expect(screen.getAllByText('$0.0042').length).toBeGreaterThan(0)
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(1_234_567)).toBe('$1.23')
  })
})
