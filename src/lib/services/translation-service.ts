import type { TargetLanguage } from './settings-service'
import { TARGET_LANGUAGES } from './settings-service'
import { aiErrorFromResponse } from './ai-api'

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
 * The error the word/sentence panel renders for a failed nibble-api call.
 * err.message is shown verbatim (word-info-panel), so the raw response body
 * is never interpolated (KAN-366). A missing or refused AI key comes back as
 * an AiApiError whose needsKeySetup is true, so the panel can link to
 * Settings > AI.
 */
function apiError(res: Response): Promise<Error> {
  return aiErrorFromResponse(res, { failed: 'Translation failed', rateLimited: 'Too many lookups — wait a moment and try again.' })
}

/**
 * Translation service. Every call goes to nibble-api's /ai routes, which run
 * it on the reader's own provider key, stored encrypted against their account
 * (bring your own key, 2026-11-17). The browser never holds a provider key.
 */
export class TranslationService {
  /**
   * Default request deadline for every interactive translation/explanation
   * fetch. Without it, a stalled upstream (Anthropic slow, nibble-api
   * overloaded, network black-hole) leaves the word/sentence panel spinner
   * running forever — callers only abort on unmount. AI generation is slower
   * than the backend's 10s KB budget, so we allow more headroom.
   */
  private static readonly DEFAULT_TIMEOUT_MS = 25_000

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

  private async postJson<T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    opts: { timeoutMs?: number; timedOut?: string } = {},
  ): Promise<T> {
    const token = await this.getToken()
    let res: Response
    try {
      res = await fetch(`${this.getApiUrl()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: this.withDeadline(signal, opts.timeoutMs),
      })
    } catch (err) {
      // The deadline fired (TimeoutError) rather than an unmount abort
      // (AbortError). Rethrow with a clearer message; callers surface it.
      if ((err as Error)?.name === 'TimeoutError') {
        throw new Error(opts.timedOut ?? 'Translation timed out — try again.')
      }
      throw err
    }
    if (!res.ok) {
      throw await apiError(res)
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
   * Figure explanation. nibble-api fetches the figure (Mathpix-hosted images
   * only) and runs it on an image-capable model on the reader's key; a reader
   * whose keys can't read images gets AI_KEY_NO_VISION. The server may spend
   * up to 15s fetching the figure before the model starts, hence the longer
   * deadline.
   */
  async explainImage(
    imageUrl: string,
    surroundingContext: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const parsed = await this.postJson<{ explanation: string }>(
      '/ai/explain-image',
      { imageUrl, surroundingContext },
      signal,
      { timeoutMs: 45_000, timedOut: 'Figure explanation timed out — try again.' },
    )
    return parsed.explanation
  }
}
