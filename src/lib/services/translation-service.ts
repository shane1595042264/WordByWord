import type { TargetLanguage } from './settings-service'
import { TARGET_LANGUAGES } from './settings-service'

/** Result from the translation API */
export interface TranslationResult {
  /** The original word */
  word: string
  /** Romanized pronunciation (IPA or language-specific like pinyin) */
  pronunciation: string
  /** Single contextual translation in target language */
  translation: string
  /** Part of speech (noun, verb, adj, etc.) */
  partOfSpeech: string
}

/** Result from sentence translation */
export interface SentenceTranslationResult {
  /** The translated sentence */
  translation: string
}

/** Result from the explanation API */
export interface ExplanationResult {
  explanation: string
}

function getLangLabel(code: TargetLanguage): string {
  return TARGET_LANGUAGES.find(l => l.code === code)?.label ?? code
}

/**
 * Translation service. Calls nibble-api endpoints which proxy Anthropic
 * server-side using ANTHROPIC_API_KEY from the backend env — no
 * user-managed API key in localStorage anymore.
 *
 * The constructor's apiKey argument is kept for backward compat but is
 * only used by explainImage (the one vision codepath that still needs
 * direct browser → Anthropic because the server flow would require the
 * user to re-upload the image).
 */
export class TranslationService {
  private apiKey: string

  /**
   * Default request deadline for every interactive translation/explanation
   * fetch. Without it, a stalled upstream (Anthropic slow, nibble-api
   * overloaded, network black-hole) leaves the word/sentence panel spinner
   * running forever — callers only abort on unmount. AI generation is slower
   * than the backend's 10s KB budget, so we allow more headroom.
   */
  private static readonly DEFAULT_TIMEOUT_MS = 25_000

  constructor(apiKey?: string | null) {
    this.apiKey = apiKey ?? ''
  }

  /**
   * Combine the caller-supplied signal (used to abort on unmount / word
   * change) with a deadline. AbortSignal.any lets BOTH fire: the caller's
   * unmount abort still short-circuits, and the timeout bounds the request
   * when no one is watching. The timeout rejects with a DOMException named
   * `TimeoutError` (not `AbortError`), so callers that early-return only on
   * AbortError correctly surface the timeout as an error.
   */
  private withDeadline(signal?: AbortSignal, timeoutMs = TranslationService.DEFAULT_TIMEOUT_MS): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async getToken(): Promise<string> {
    const r = await fetch('/api/auth/token', { credentials: 'include' })
    if (!r.ok) throw new Error('Not authenticated')
    const { token } = await r.json()
    if (!token) throw new Error('Not authenticated')
    return token
  }

  private getApiUrl(): string {
    return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
  }

  private async postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const token = await this.getToken()
    let res: Response
    try {
      res = await fetch(`${this.getApiUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: this.withDeadline(signal),
      })
    } catch (err) {
      // The deadline fired (TimeoutError) rather than an unmount abort
      // (AbortError). Rethrow with a clearer message; callers surface it.
      if ((err as Error)?.name === 'TimeoutError') {
        throw new Error('Translation timed out — try again.')
      }
      throw err
    }
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Translation API error (${res.status}): ${text.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  /** Translate a word in context. */
  async translateWord(
    word: string,
    sentence: string,
    targetLang: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<TranslationResult> {
    const langName = getLangLabel(targetLang)
    const parsed = await this.postJson<{ pronunciation: string; translation: string; partOfSpeech: string }>(
      '/ai/translate-word',
      { word, sentence, targetLanguage: langName },
      signal,
    )
    return {
      word,
      pronunciation: parsed.pronunciation,
      translation: parsed.translation,
      partOfSpeech: parsed.partOfSpeech,
    }
  }

  /** Translate a full sentence with paragraph context. */
  async translateSentence(
    sentence: string,
    paragraphText: string,
    targetLang: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<SentenceTranslationResult> {
    const langName = getLangLabel(targetLang)
    const parsed = await this.postJson<{ translation: string }>(
      '/ai/translate-sentence',
      { sentence, paragraphContext: paragraphText, targetLanguage: langName },
      signal,
    )
    return { translation: parsed.translation }
  }

  /** Why was this specific translation chosen? */
  async explainTranslation(
    word: string,
    sentence: string,
    translation: string,
    targetLang: TargetLanguage,
    signal?: AbortSignal,
  ): Promise<ExplanationResult> {
    const langName = getLangLabel(targetLang)
    const parsed = await this.postJson<{ explanation: string }>(
      '/ai/explain-translation',
      { word, sentence, translation, targetLanguage: langName },
      signal,
    )
    return { explanation: parsed.explanation }
  }

  /** Explain a block of content (table, code, formula, etc.). */
  async explainContent(content: string, surroundingContext: string, signal?: AbortSignal): Promise<string> {
    const parsed = await this.postJson<{ explanation: string }>(
      '/ai/explain-content',
      { content, surroundingContext },
      signal,
    )
    return parsed.explanation
  }

  /**
   * Vision-powered figure explanation. Still uses the user's own Anthropic
   * key because the backend doesn't have a URL-based vision endpoint yet,
   * and proxying image bytes through the backend would require fetching
   * the R2-hosted image twice. Falls through with a clear error when the
   * user hasn't supplied a key.
   */
  async explainImage(
    imageUrl: string,
    surroundingContext: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Figure explanation requires an Anthropic API key in Settings (vision).')
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: imageUrl } },
            {
              type: 'text',
              text: `Explain this figure/diagram clearly. What does it show? How does it relate to the surrounding text?\n\nSurrounding context: ${surroundingContext}`,
            },
          ],
        }],
      }),
      signal: this.withDeadline(signal),
    }).catch((err) => {
      if ((err as Error)?.name === 'TimeoutError') {
        throw new Error('Figure explanation timed out — try again.')
      }
      throw err
    })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Vision API error (${res.status}): ${errorText.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  }
}
