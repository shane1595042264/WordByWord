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
  region: null,
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

  it('names the provider as the reader pastes, for every format Nibbler knows', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    const input = await screen.findByLabelText('Add a key')
    const add = screen.getByRole('button', { name: /Add key/ }) as HTMLButtonElement

    fireEvent.change(input, { target: { value: 'sk-ant-api03-abc' } })
    expect(screen.getByText('Anthropic Claude key detected.')).toBeTruthy()
    expect(add.disabled).toBe(false)

    // Google's new Gemini format (a reader's key was refused before 2026-11-17).
    fireEvent.change(input, { target: { value: 'AQ.Ab8R' + 'n'.repeat(45) } })
    expect(screen.getByText('Google Gemini key detected.')).toBeTruthy()

    // Groq used to be turned away; now it's just another provider.
    fireEvent.change(input, { target: { value: 'gsk_' + 'z'.repeat(40) } })
    expect(screen.getByText('Groq key detected.')).toBeTruthy()
    expect(add.disabled).toBe(false)
  })

  it('a format several providers share says who will be asked, in what order', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    fireEvent.change(await screen.findByLabelText('Add a key'), { target: { value: 'sk-' + '0123456789abcdef'.repeat(2) } })
    expect(screen.getByText(/^DeepSeek or Qwen \(Alibaba Model Studio\) all use this format/)).toBeTruthy()
  })

  it("a format it can't place waits for the reader to pick the provider, then sends it only there", async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    api.addAiKey.mockResolvedValue({ ...gemini, id: 'k-mis', provider: 'mistral' })
    render(<AiKeysSettings />)
    const add = screen.getByRole('button', { name: /Add key/ }) as HTMLButtonElement
    fireEvent.change(await screen.findByLabelText('Add a key'), { target: { value: 'brand-new-format-' + 'k'.repeat(30) } })
    expect(screen.getByText(/Pick it from the list/)).toBeTruthy()
    expect(add.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'mistral' } })
    expect(screen.getByText('Will be checked with Mistral only.')).toBeTruthy()
    fireEvent.click(add)
    await waitFor(() => expect(api.addAiKey).toHaveBeenCalledWith('brand-new-format-' + 'k'.repeat(30), 'mistral'))
  })

  it('still refuses what can never be a usable key', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    fireEvent.change(await screen.findByLabelText('Add a key'), { target: { value: 'sk-ant-admin01-' + 'x'.repeat(40) } })
    expect(screen.getByText(/Admin key/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Add key/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists every supported provider with its key format and where to get one', async () => {
    api.fetchAiKeys.mockResolvedValue({
      keys: [],
      settings: { preferredProvider: null },
      providers: [
        { id: 'gemini', label: 'Google Gemini', keyFormat: 'AQ.… or AIza…', keysUrl: 'https://aistudio.google.com/apikey' },
        { id: 'deepseek', label: 'DeepSeek', keyFormat: 'sk-…', keysUrl: 'https://platform.deepseek.com/api_keys' },
      ],
    })
    render(<AiKeysSettings />)
    expect(await screen.findByText('Supported providers (2)')).toBeTruthy()
    const links = screen.getAllByRole('link', { name: 'Get a key' }) as HTMLAnchorElement[]
    expect(links.map((a) => a.href)).toEqual(['https://aistudio.google.com/apikey', 'https://platform.deepseek.com/api_keys'])
    expect(screen.getByText('AQ.… or AIza…')).toBeTruthy()
  })

  it('adds a key, lists it with its model choice, and clears the field', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [], settings: { preferredProvider: null } })
    api.addAiKey.mockResolvedValue({ ...gemini, region: null })
    render(<AiKeysSettings />)
    const input = (await screen.findByLabelText('Add a key')) as HTMLInputElement

    fireEvent.change(input, { target: { value: 'AIza' + 'k'.repeat(35) } })
    fireEvent.click(screen.getByRole('button', { name: /Add key/ }))

    await waitFor(() => expect(api.addAiKey).toHaveBeenCalledWith('AIza' + 'k'.repeat(35), undefined))
    expect(await screen.findByText('••••WXYZ')).toBeTruthy()
    expect(screen.getByText('Reads page images')).toBeTruthy()
    expect(input.value).toBe('')
  })

  it('a key found on a regional server says which one', async () => {
    api.fetchAiKeys.mockResolvedValue({ keys: [{ ...gemini, id: 'k-q', provider: 'qwen', region: 'China' }], settings: { preferredProvider: null } })
    render(<AiKeysSettings />)
    expect(await screen.findByText('China server')).toBeTruthy()
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

    await waitFor(() => expect(api.addAiKey).toHaveBeenCalledWith('sk-ant-old-key-1234567890', 'anthropic'))
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
