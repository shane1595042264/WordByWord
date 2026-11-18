/**
 * nibble-api's /ai routes from the browser.
 *
 * Since 2026-11-17 every AI call runs on the reader's OWN provider key (bring
 * your own key). The key is pasted once in Settings > AI, checked with one tiny
 * call, then stored encrypted by nibble-api against the account, so it follows
 * the reader to every device. The browser never holds or sends it after that.
 * A call without a working key answers 409 with an AI_KEY_* code; the copy is
 * written for the reader, and the UI adds a link to the AI tab.
 */

/** Mirrors nibble-api src/ai/registry.ts. GET /ai/keys returns the same list with key formats and links. */
export type AiProvider =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'qwen'
  | 'moonshot'
  | 'zhipu'
  | 'siliconflow'
  | 'together'
  | 'fireworks'
  | 'deepinfra'
  | 'cerebras'
  | 'perplexity'

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  xai: 'xAI Grok',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  mistral: 'Mistral',
  qwen: 'Qwen (Alibaba Model Studio)',
  moonshot: 'Moonshot Kimi',
  zhipu: 'Zhipu GLM (Z.ai)',
  siliconflow: 'SiliconFlow',
  together: 'Together AI',
  fireworks: 'Fireworks AI',
  deepinfra: 'DeepInfra',
  cerebras: 'Cerebras',
  perplexity: 'Perplexity',
}

export const AI_PROVIDERS = Object.keys(AI_PROVIDER_LABEL) as AiProvider[]

/** A provider row as GET /ai/keys describes it. */
export interface AiProviderInfo {
  id: AiProvider
  label: string
  keyFormat: string
  keysUrl: string
}

/** "OpenAI, DeepSeek or Qwen". */
export function providerList(providers: AiProvider[]): string {
  const labels = providers.map((p) => AI_PROVIDER_LABEL[p] ?? p)
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** Where every "add a key" link points. */
export const AI_KEY_SETUP_HREF = '/settings?tab=ai'

const KEY_SETUP_CODES = new Set(['AI_KEY_REQUIRED', 'AI_KEY_NO_VISION', 'AI_KEY_REJECTED'])

export class AiApiError extends Error {
  readonly name = 'AiApiError'
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message)
  }

  /** The fix is in Settings > AI: no key, no image-capable key, or a refused key. */
  get needsKeySetup(): boolean {
    return this.code !== null && KEY_SETUP_CODES.has(this.code)
  }
}

export function needsAiKeySetup(err: unknown): boolean {
  return err instanceof AiApiError && err.needsKeySetup
}

/**
 * The reader-facing error for a failed /ai call. Never interpolates the raw
 * body (KAN-366). AI_* envelopes are written for the reader and name the
 * provider, so they are shown as they are; other 429/5xx get fixed copy, and
 * any other envelope keeps its own message.
 */
export async function aiErrorFromResponse(
  res: Response,
  opts: { failed: string; rateLimited?: string } = { failed: 'The AI request failed' },
): Promise<AiApiError> {
  let code: string | null = null
  let message: string | null = null
  try {
    const body = await res.json()
    if (typeof body?.error?.code === 'string') code = body.error.code
    if (typeof body?.error?.message === 'string' && body.error.message) message = body.error.message
  } catch {
    // Not the JSON envelope (a proxy error page, say).
  }
  if (code?.startsWith('AI_') && message) return new AiApiError(message, res.status, code)
  if (res.status === 429) {
    return new AiApiError(opts.rateLimited ?? 'Too many requests — wait a moment and try again.', 429, code)
  }
  if (res.status >= 500) return new AiApiError('The AI service is busy — try again in a moment.', res.status, code)
  return new AiApiError(message ?? `${opts.failed} (${res.status}) — try again.`, res.status, code)
}

// ─── Instant provider hint ─────────────────────────────────────────

export interface KeyDetection {
  /** Providers whose key format this matches, most likely first. Empty when unknown. */
  candidates: AiProvider[]
  /** Set when the key can't be used whatever provider is picked (spaces, an admin key). */
  fatal?: string
}

/**
 * Which provider(s) a pasted key could be from, for the hint under the field
 * while the reader pastes. Mirrors nibble-api src/ai/detect.ts, whose answer is
 * the one that counts. A format it can't place is not refused: the reader
 * picks the provider. Only a key that can't be one at all is.
 */
export function detectKeyProvider(raw: string): KeyDetection {
  const key = raw.trim()
  if (!key) return { candidates: [] }
  if (/\s/.test(key)) return { candidates: [], fatal: 'A key has no spaces in it. Paste only the key.' }
  if (key.startsWith('sk-ant-admin')) return { candidates: [], fatal: 'That is an Anthropic Admin key, which cannot run models.' }
  if (key.startsWith('sk-admin-')) return { candidates: [], fatal: 'That is an OpenAI Admin key, which cannot run models.' }
  if (key.startsWith('sk-ant-')) return { candidates: ['anthropic'] }
  if (key.startsWith('sk-or-')) return { candidates: ['openrouter'] }
  if (/^sk-(proj|svcacct|None)-/.test(key) || key.includes('T3BlbkFJ')) return { candidates: ['openai'] }
  if (key.startsWith('xai-')) return { candidates: ['xai'] }
  if (key.startsWith('gsk_')) return { candidates: ['groq'] }
  if (key.startsWith('csk-')) return { candidates: ['cerebras'] }
  if (key.startsWith('fw_')) return { candidates: ['fireworks'] }
  if (key.startsWith('pplx-')) return { candidates: ['perplexity'] }
  if (key.startsWith('tgp_v1_') || /^[0-9a-f]{64}$/.test(key)) return { candidates: ['together'] }
  if (key.startsWith('AQ.') || key.startsWith('AIza')) return { candidates: ['gemini'] }
  if (key.startsWith('sk-')) {
    const body = key.slice(3)
    if (/^[0-9a-f]{32}$/.test(body)) return { candidates: ['deepseek', 'qwen'] }
    if (/^[a-z]{40,60}$/.test(body)) return { candidates: ['siliconflow', 'moonshot', 'openai'] }
    return { candidates: ['openai', 'deepseek', 'moonshot', 'qwen', 'siliconflow'] }
  }
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{8,}$/.test(key)) return { candidates: ['zhipu'] }
  if (/^[A-Za-z0-9]{32}$/.test(key)) return { candidates: ['mistral', 'deepinfra'] }
  return { candidates: [] }
}

// ─── Keys, settings, usage ─────────────────────────────────────────

export interface AiKey {
  id: string
  provider: AiProvider
  /** "China" when the key lives on a provider's China server; null on its default one. */
  region: string | null
  keyHint: string
  models: string[]
  /** Models on this key that can read page images (OCR, tables of contents, figures). */
  imageModels: string[]
  defaultModel: string
  preferredModel: string | null
  status: 'ok' | 'failing'
  lastError: string | null
  lastCheckedAt: string
  createdAt: string
}

export interface AiSettings {
  preferredProvider: AiProvider | null
}

export interface AiUsage {
  days: number
  totals: { calls: number; inputTokens: number; outputTokens: number; costMicroUsd: number }
  byModel: Array<{ provider: AiProvider; model: string; calls: number; inputTokens: number; outputTokens: number; costMicroUsd: number }>
  byFeature: Array<{ feature: string; calls: number; costMicroUsd: number }>
  daily: Array<{ day: string; tokens: number; costMicroUsd: number }>
  recent: Array<{
    id: string
    provider: AiProvider
    model: string
    feature: string
    inputTokens: number
    outputTokens: number
    costMicroUsd: number | null
    createdAt: string
  }>
}

function apiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
}

async function authToken(): Promise<string> {
  const res = await fetch('/api/auth/token', { credentials: 'include' })
  const token = res.ok ? (await res.json())?.token : null
  if (!token) throw new AiApiError('You are signed out. Sign in again and retry.', 401, 'UNAUTHORIZED')
  return token
}

async function request<T>(method: string, path: string, body?: unknown, failed = 'The request failed'): Promise<T> {
  const token = await authToken()
  const res = await fetch(`${apiUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw await aiErrorFromResponse(res, { failed })
  return (res.status === 204 ? undefined : await res.json()) as T
}

export function fetchAiKeys(): Promise<{ keys: AiKey[]; settings: AiSettings; providers?: AiProviderInfo[] }> {
  return request('GET', '/ai/keys', undefined, 'Could not load your AI keys')
}

/**
 * Proves the key with one tiny call, then stores it encrypted. Without
 * `provider` nibble-api works out whose key it is from its format, asking the
 * likely owners in turn when several share it; with one, only that provider
 * sees the key.
 */
export async function addAiKey(key: string, provider?: AiProvider): Promise<AiKey> {
  return (await request<{ key: AiKey }>('POST', '/ai/keys', provider ? { key, provider } : { key }, 'Could not add that key')).key
}

/** null goes back to the cheapest model that answered when the key was checked. */
export async function setAiKeyModel(id: string, preferredModel: string | null): Promise<AiKey> {
  return (await request<{ key: AiKey }>('PATCH', `/ai/keys/${id}`, { preferredModel }, 'Could not change the model')).key
}

export async function recheckAiKey(id: string): Promise<AiKey> {
  return (await request<{ key: AiKey }>('POST', `/ai/keys/${id}/check`, {}, 'Could not check that key')).key
}

export function removeAiKey(id: string): Promise<void> {
  return request('DELETE', `/ai/keys/${id}`, undefined, 'Could not remove that key')
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  return (await request<{ settings: AiSettings }>('PATCH', '/ai/settings', patch, 'Could not save')).settings
}

export function fetchAiUsage(days = 30): Promise<AiUsage> {
  return request('GET', `/ai/usage?days=${days}`, undefined, 'Could not load usage')
}

/**
 * The ? dialog's fallback when no shortcut's words match the question: the
 * reader's own model picks the ids that answer it. Only ids from `shortcuts`
 * come back.
 */
export async function searchShortcutsWithAi(
  query: string,
  shortcuts: Array<{ id: string; label: string; description: string }>,
): Promise<string[]> {
  return (await request<{ ids: string[] }>('POST', '/ai/search-shortcuts', { query, shortcuts }, 'Shortcut search failed')).ids
}
