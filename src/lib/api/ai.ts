import { apiClient } from './client'

export async function getWordContext(word: string, sentence: string, bookContext?: string) {
  return apiClient<{ definition: string; translation?: string; explanation: string }>('/ai/word-context', {
    method: 'POST',
    body: JSON.stringify({ word, sentence, bookContext }),
  })
}

export async function translateText(text: string, targetLanguage: string) {
  const result = await apiClient<{ translation: string }>('/ai/translate', {
    method: 'POST',
    body: JSON.stringify({ text, targetLanguage }),
  })
  return result.translation
}

export async function explainText(text: string, bookContext?: string) {
  const result = await apiClient<{ explanation: string }>('/ai/explain', {
    method: 'POST',
    body: JSON.stringify({ text, bookContext }),
  })
  return result.explanation
}
