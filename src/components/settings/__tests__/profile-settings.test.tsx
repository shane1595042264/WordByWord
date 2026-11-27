import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// KAN-425: a single failed GET /users/me on first load used to leave Settings >
// Profile on a bare "Failed to load profile" line with no way to try again.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, update: vi.fn() }),
}))

const { ProfileSettings } = await import('../profile-settings')

const profile = {
  id: 'u1',
  email: 'reader@example.com',
  name: 'Reader',
  avatarUrl: null,
  authRole: 'user',
  hasPassword: true,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

let meResponses: Response[]
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  if (url === '/api/auth/token') return json({ token: 't' })
  if (url.endsWith('/users/me')) return meResponses.shift() ?? json(profile)
  throw new Error(`unexpected fetch ${url}`)
})

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProfileSettings', () => {
  it('renders the form and Password section when the profile loads', async () => {
    meResponses = [json(profile)]
    render(<ProfileSettings />)
    expect(await screen.findByLabelText('Display name')).toBeTruthy()
    expect(screen.getByText('Change password')).toBeTruthy()
  })

  it('offers Retry after a failed first load, and Retry recovers the form', async () => {
    meResponses = [json({ error: 'boom' }, 500), json(profile)]
    render(<ProfileSettings />)
    expect(await screen.findByText('Failed to load profile')).toBeTruthy()
    expect(screen.queryByLabelText('Display name')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByLabelText('Display name')).toBeTruthy()
    expect(screen.getByText('Change password')).toBeTruthy()
    expect(screen.queryByText('Failed to load profile')).toBeNull()
  })
})
