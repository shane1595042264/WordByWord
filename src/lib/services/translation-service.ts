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
 * Translation service using Anthropic Claude API.
 * All calls go through a client-side fetch to the Anthropic API directly
 * (API key is stored in the user's browser).
 */
export class TranslationService {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Translate a word in context. Returns a single, precise translation
   * plus pronunciation info.
   */
  async translateWord(
    word: string,
    sentence: string,
    targetLang: TargetLanguage,
  ): Promise<TranslationResult> {
    const langName = getLangLabel(targetLang)
    const prompt = `You are a precise dictionary/translator. Given an English word and the sentence it appears in, provide:
1. The romanized pronunciation of the ENGLISH word (IPA format, e.g. /deɪ/ for "day")
2. A single, contextually accurate ${langName} translation — just ONE word or very short phrase, not multiple definitions
3. The part of speech (n., v., adj., adv., prep., conj., etc.)

Word: "${word}"
Sentence: "${sentence}"

Respond in this exact JSON format only, no other text:
{"pronunciation": "/.../ ", "translation": "...", "partOfSpeech": "..."}`

    const response = await this.callClaude(prompt, 150)
    try {
      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')
      const parsed = JSON.parse(jsonMatch[0])
      return {
        word,
        pronunciation: parsed.pronunciation || '',
        translation: parsed.translation || '',
        partOfSpeech: parsed.partOfSpeech || '',
      }
    } catch {
      // Fallback if parsing fails
      return {
        word,
        pronunciation: '',
        translation: response.slice(0, 50),
        partOfSpeech: '',
      }
    }
  }

  /**
   * Translate an entire sentence in the context of its paragraph.
   * Returns a single clean translated sentence — no extras.
   */
  async translateSentence(
    sentence: string,
    paragraphText: string,
    targetLang: TargetLanguage,
  ): Promise<SentenceTranslationResult> {
    const langName = getLangLabel(targetLang)
    const prompt = `Translate the following English sentence into ${langName}. Use the surrounding paragraph for context to ensure accuracy. Return ONLY the translated sentence, nothing else.

Sentence: "${sentence}"

Paragraph context: "${paragraphText}"`

    const translation = await this.callClaude(prompt, 300)
    return { translation: translation.trim().replace(/^["']|["']$/g, '') }
  }

  /**
   * Explain why a specific translation was chosen for the word in context.
   * Keep it under 100 words.
   */
  async explainTranslation(
    word: string,
    sentence: string,
    translation: string,
    targetLang: TargetLanguage,
  ): Promise<ExplanationResult> {
    const langName = getLangLabel(targetLang)
    const prompt = `Explain briefly (under 100 words) why the English word "${word}" is translated as "${translation}" in ${langName}, given the sentence: "${sentence}". Focus on how the sentence context determines this specific meaning. Be concise and direct.`

    const explanation = await this.callClaude(prompt, 200)
    return { explanation }
  }

  /**
   * Explain content (table, code block, formula, or any text) in context.
   * Used for explanation mode instead of translation.
   */
  async explainContent(
    content: string,
    surroundingContext: string,
  ): Promise<string> {
    const prompt = `Explain the following content clearly and concisely. What does it mean, what is it showing, and how does it relate to the surrounding context?

Content:
${content}

Surrounding context:
${surroundingContext}

Give a clear explanation in English. If it's a table, explain what the data represents. If it's code, explain the algorithm. If it's a formula, explain what each variable means. Be thorough but concise.`

    return this.callClaude(prompt, 500)
  }

  /**
   * Explain a figure/image using Claude Vision.
   * Sends the image URL directly to Claude for visual analysis.
   */
  async explainImage(
    imageUrl: string,
    surroundingContext: string,
  ): Promise<string> {
    // Use Claude's URL-based image source — no need to fetch/base64 ourselves
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
            {
              type: 'image',
              source: { type: 'url', url: imageUrl },
            },
            {
              type: 'text',
              text: `Explain this figure/diagram clearly. What does it show? How does it relate to the surrounding text?\n\nSurrounding context: ${surroundingContext}`,
            },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Vision API error (${res.status}): ${errorText}`)
    }

    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  }

  private async callClaude(prompt: string, maxTokens: number): Promise<string> {
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
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Anthropic API error (${res.status}): ${errorText}`)
    }

    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  }
}
