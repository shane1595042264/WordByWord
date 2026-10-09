import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({
  getByEmail: vi.fn(),
  getByProviderAccount: vi.fn(),
  getById: vi.fn(),
  linkAccount: vi.fn(),
  clearPassword: vi.fn(),
  createFromOAuth: vi.fn(),
  updateProfile: vi.fn(),
}))

const captured = vi.hoisted(() => ({ config: null as any }))

vi.mock('next-auth', () => ({
  default: (config: unknown) => {
    captured.config = config
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() }
  },
}))
vi.mock('next-auth/providers/credentials', () => ({ default: (c: unknown) => c }))
vi.mock('next-auth/providers/google', () => ({ default: (c: unknown) => c }))
vi.mock('../user-repository', () => ({
  UserRepository: class {
    constructor() {
      return repo
    }
  },
  stableEmojiForId: () => '🦊',
}))

await import('../config')
const { signIn, jwt } = captured.config.callbacks

function dbUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Victim',
    email: 'victim@gmail.com',
    emailVerified: false,
    passwordHash: 'squatted-hash',
    image: '🐼',
    role: 'user',
    ...overrides,
  }
}

const googleAccount = { provider: 'google', providerAccountId: 'g-123' }
const googleProfile = (emailVerified: unknown) => ({
  email: 'victim@gmail.com',
  name: 'Victim',
  email_verified: emailVerified,
})

describe('OAuth sign-in onto an existing email (KAN-341)', () => {
  beforeEach(() => {
    for (const fn of Object.values(repo)) fn.mockReset()
    repo.getByProviderAccount.mockResolvedValue(null)
  })

  it('clears an unverified self-signup password before linking Google', async () => {
    repo.getByEmail.mockResolvedValue(dbUser())
    const user: Record<string, unknown> = { id: 'oauth-sub' }

    await expect(signIn({ user, account: googleAccount, profile: googleProfile(true) })).resolves.toBe(true)

    expect(repo.clearPassword).toHaveBeenCalledWith('u1')
    expect(repo.linkAccount).toHaveBeenCalledWith('u1', 'google', 'g-123', expect.any(Object))
    expect(repo.clearPassword.mock.invocationCallOrder[0])
      .toBeLessThan(repo.linkAccount.mock.invocationCallOrder[0])
    expect(user.id).toBe('u1')
  })

  it('keeps the password of an already-verified account and links as before', async () => {
    repo.getByEmail.mockResolvedValue(dbUser({ emailVerified: true }))
    const user: Record<string, unknown> = { id: 'oauth-sub' }

    await expect(signIn({ user, account: googleAccount, profile: googleProfile(true) })).resolves.toBe(true)

    expect(repo.clearPassword).not.toHaveBeenCalled()
    expect(repo.linkAccount).toHaveBeenCalledWith('u1', 'google', 'g-123', expect.any(Object))
    expect(user.id).toBe('u1')
  })

  it('does not touch the password when the Google identity is already linked', async () => {
    repo.getByEmail.mockResolvedValue(dbUser())
    repo.getByProviderAccount.mockResolvedValue(dbUser())

    await expect(signIn({ user: {}, account: googleAccount, profile: googleProfile(undefined) })).resolves.toBe(true)

    expect(repo.clearPassword).not.toHaveBeenCalled()
    expect(repo.linkAccount).not.toHaveBeenCalled()
  })

  it.each([false, undefined])('refuses to link when the provider email_verified is %s', async (claim) => {
    repo.getByEmail.mockResolvedValue(dbUser())

    await expect(signIn({ user: {}, account: googleAccount, profile: googleProfile(claim) })).resolves.toBe(false)

    expect(repo.clearPassword).not.toHaveBeenCalled()
    expect(repo.linkAccount).not.toHaveBeenCalled()
  })

  it('still creates a brand-new Google user', async () => {
    repo.getByEmail.mockResolvedValue(null)
    repo.createFromOAuth.mockResolvedValue(dbUser({ id: 'new', passwordHash: null, emailVerified: true }))
    const user: Record<string, unknown> = {}

    await expect(signIn({ user, account: googleAccount, profile: googleProfile(true) })).resolves.toBe(true)

    expect(repo.createFromOAuth).toHaveBeenCalled()
    expect(repo.linkAccount).toHaveBeenCalledWith('new', 'google', 'g-123', expect.any(Object))
    expect(user.id).toBe('new')
  })

  it('refuses to create a user from an unverified provider email', async () => {
    repo.getByEmail.mockResolvedValue(null)

    await expect(signIn({ user: {}, account: googleAccount, profile: googleProfile(false) })).resolves.toBe(false)

    expect(repo.createFromOAuth).not.toHaveBeenCalled()
  })
})

describe('jwt session refresh after a password is cleared (KAN-341)', () => {
  const stale = (authProvider: string | undefined) => ({ id: 'u1', role: 'user', roleCheckedAt: 0, authProvider })

  beforeEach(() => {
    for (const fn of Object.values(repo)) fn.mockReset()
  })

  it('records the provider that issued the session', async () => {
    const token = await jwt({ token: {}, user: { id: 'u1' }, account: { provider: 'credentials' } })
    expect(token.authProvider).toBe('credentials')
  })

  it('ends a password session once the account has no password', async () => {
    repo.getById.mockResolvedValue(dbUser({ passwordHash: null, emailVerified: true }))
    await expect(jwt({ token: stale('credentials') })).resolves.toBeNull()
  })

  it('keeps a password session while the password still exists', async () => {
    repo.getById.mockResolvedValue(dbUser())
    await expect(jwt({ token: stale('credentials') })).resolves.toMatchObject({ id: 'u1' })
  })

  it('keeps the Google session of a password-less account', async () => {
    repo.getById.mockResolvedValue(dbUser({ passwordHash: null, emailVerified: true }))
    await expect(jwt({ token: stale('google') })).resolves.toMatchObject({ id: 'u1' })
  })
})
