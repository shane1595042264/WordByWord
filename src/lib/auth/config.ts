/**
 * Auth.js (NextAuth v5) configuration.
 * - Credentials provider (email + password)
 * - Google OAuth provider
 * - JWT sessions (no server session store needed)
 * - Account linking support
 */
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { UserRepository, stableEmojiForId } from './user-repository'
import { checkRateLimit, getClientIp } from './rate-limit'

const userRepo = new UserRepository()

const LOGIN_PER_IP_MAX = 10
const LOGIN_PER_IP_WINDOW_MS = 60 * 1000
const LOGIN_PER_EMAIL_MAX = 10
const LOGIN_PER_EMAIL_WINDOW_MS = 60 * 1000

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email as string
        const password = credentials.password as string

        // Rate-limit BEFORE bcrypt.compare to bound CPU cost. Per-IP limit
        // protects against single-attacker DoS; per-email limit protects a
        // specific account from credential stuffing across many IPs.
        // We log to the server console only (returning null surfaces a generic
        // CredentialsSignin error to the user, no enumeration leak).
        const ip = getClientIp(request.headers)
        const ipLimit = checkRateLimit(`login:ip:${ip}`, LOGIN_PER_IP_MAX, LOGIN_PER_IP_WINDOW_MS)
        if (!ipLimit.allowed) {
          console.warn(`[auth] login rate limit hit for IP ${ip}`)
          return null
        }
        const emailLimit = checkRateLimit(
          `login:email:${email.toLowerCase()}`,
          LOGIN_PER_EMAIL_MAX,
          LOGIN_PER_EMAIL_WINDOW_MS,
        )
        if (!emailLimit.allowed) {
          console.warn(`[auth] login rate limit hit for email ${email.toLowerCase()}`)
          return null
        }

        const user = await userRepo.getByEmail(email)
        if (!user) return null

        const valid = await userRepo.verifyPassword(user, password)
        if (!valid) return null

        // Backfill: assign a stable emoji if user has no avatar. If the DB
        // write fails we keep the same emoji across attempts (id-derived) so
        // the user doesn't see the avatar shuffle on every sign-in, and we
        // surface the failure to logs instead of swallowing it.
        let image = user.image
        if (!image) {
          image = stableEmojiForId(user.id)
          await userRepo.updateProfile(user.id, { image }).catch((err: unknown) => {
            console.error('[auth] avatar backfill failed for user %s: %s', user.id, err)
          })
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image,
          role: user.role,
        }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),
  ],

  session: { strategy: 'jwt' },

  pages: {
    signIn: '/auth/login',
    error: '/auth/login',
  },

  callbacks: {
    async signIn({ user, account, profile }) {
      // Credentials provider — already verified in authorize()
      if (account?.provider === 'credentials') return true

      // OAuth provider (Google, etc.)
      if (account && profile?.email) {
        const email = profile.email
        const existingUser = await userRepo.getByEmail(email)

        if (existingUser) {
          // Check if this OAuth account is already linked
          const linked = await userRepo.getByProviderAccount(account.provider, account.providerAccountId)
          if (!linked) {
            // Auto-link: same email → link the OAuth account to existing user
            await userRepo.linkAccount(existingUser.id, account.provider, account.providerAccountId, {
              accessToken: account.access_token ?? undefined,
              refreshToken: account.refresh_token ?? undefined,
              expiresAt: account.expires_at ?? undefined,
              idToken: account.id_token ?? undefined,
              scope: account.scope ?? undefined,
              tokenType: account.token_type ?? undefined,
            })
          }
          // Use the existing user's ID
          user.id = existingUser.id
          user.name = existingUser.name ?? user.name
          // Backfill: assign a stable id-derived emoji if existing user has
          // no avatar. Same reasoning as the credentials path — keep the
          // emoji stable across retries and log DB failures.
          if (existingUser.image) {
            user.image = existingUser.image
          } else {
            const emoji = stableEmojiForId(existingUser.id)
            await userRepo.updateProfile(existingUser.id, { image: emoji }).catch((err: unknown) => {
              console.error('[auth] avatar backfill failed for user %s: %s', existingUser.id, err)
            })
            user.image = emoji
          }
          ;(user as Record<string, unknown>).role = existingUser.role
        } else {
          // New user — create account from OAuth
          const newUser = await userRepo.createFromOAuth(
            email,
            profile.name ?? null,
            (profile as Record<string, unknown>).picture as string ?? null,
          )
          await userRepo.linkAccount(newUser.id, account.provider, account.providerAccountId, {
            accessToken: account.access_token ?? undefined,
            refreshToken: account.refresh_token ?? undefined,
            expiresAt: account.expires_at ?? undefined,
            idToken: account.id_token ?? undefined,
            scope: account.scope ?? undefined,
            tokenType: account.token_type ?? undefined,
          })
          user.id = newUser.id
          user.image = newUser.image
          ;(user as Record<string, unknown>).role = newUser.role
        }
      }

      return true
    },

    async jwt({ token, user, trigger, session: updateData }) {
      // On initial sign-in, add user data to the JWT
      if (user) {
        token.id = user.id
        token.role = (user as Record<string, unknown>).role ?? 'user'
        token.picture = user.image ?? null
      }
      // Handle session updates (e.g. profile changes from settings page)
      if (trigger === 'update' && updateData) {
        if ((updateData as Record<string, unknown>).name !== undefined) {
          token.name = (updateData as Record<string, unknown>).name as string
        }
        if ((updateData as Record<string, unknown>).image !== undefined) {
          token.picture = (updateData as Record<string, unknown>).image as string
        }
      }
      return token
    },

    async session({ session, token }) {
      // Expose user ID, role, and image in the session
      if (session.user) {
        session.user.id = token.id as string
        ;(session.user as unknown as Record<string, unknown>).role = token.role
        session.user.image = (token.picture as string) ?? null
        if (token.name) session.user.name = token.name as string
      }
      return session
    },
  },
})
