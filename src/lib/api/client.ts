const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'

let cachedToken: string | null = null
let tokenExpiresAt = 0

async function getToken(): Promise<string> {
  // Return cached token if still valid (refresh 5 min before expiry)
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken
  }

  const res = await fetch('/api/auth/token')
  if (!res.ok) throw new Error('Failed to get auth token')
  const { token } = await res.json()

  cachedToken = token
  // JWT is valid for 24h
  tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000
  return token
}

export function clearTokenCache() {
  cachedToken = null
  tokenExpiresAt = 0
}

export async function apiClient<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken()

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(error.error?.message || `API error: ${res.status}`)
  }

  return res.json()
}

// Multipart upload (for PDF files)
export async function apiUpload<T = any>(
  path: string,
  formData: FormData
): Promise<T> {
  const token = await getToken()

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      // Don't set Content-Type — browser will set it with boundary for FormData
    },
    body: formData,
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }))
    throw new Error(error.error?.message || `API error: ${res.status}`)
  }

  return res.json()
}
