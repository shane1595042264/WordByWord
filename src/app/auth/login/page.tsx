'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { sanitizeCallbackUrl } from '@/lib/auth/safe-redirect'
import {
  AuthShell,
  GoogleMark,
  OrDivider,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from '@/components/auth/auth-shell'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = sanitizeCallbackUrl(searchParams.get('callbackUrl'))
  const errorParam = searchParams.get('error')
  const registered = searchParams.get('registered') === '1'
  const prefilledEmail = searchParams.get('email') ?? ''

  const [email, setEmail] = useState(prefilledEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(errorParam === 'OAuthAccountNotLinked'
    ? 'This email is already registered. Sign in with your password first, then link Google in settings.'
    : errorParam ? 'Authentication failed. Please try again.' : '')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (result?.error) {
      setError('Invalid email or password')
      setLoading(false)
    } else {
      router.push(callbackUrl)
      router.refresh()
    }
  }

  const handleGoogleLogin = () => {
    if (loading) return
    setError('')
    setOauthLoading(true)
    setLoading(true)
    signIn('google', { callbackUrl })
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to pick up where you left off.">
        {registered && !error && (
          <div role="status" aria-live="polite" className="mb-5 rounded-md bg-accent px-3 py-2.5 text-sm text-accent-foreground">
            Your account was created. Please sign in.
          </div>
        )}

        {error && (
          <div role="alert" aria-live="assertive" className="mb-5 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleCredentialsLogin} aria-busy={loading} className="space-y-4">
          <div>
            <label htmlFor="email" className={authLabelClass}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className={authLabelClass}>Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className={authInputClass}
            />
          </div>
          <button type="submit" disabled={loading} className={`${authPrimaryButtonClass} mt-2`}>
            {loading && !oauthLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <OrDivider />

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          aria-busy={oauthLoading}
          className={authSecondaryButtonClass}
        >
          <GoogleMark />
          {oauthLoading ? 'Redirecting…' : 'Sign in with Google'}
        </button>

        <p className="mt-8 text-sm text-muted-foreground">
          Don&apos;t have an account?{' '}
          <Link href="/auth/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
    </AuthShell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground" aria-busy="true">Loading...</div>}>
      <LoginForm />
    </Suspense>
  )
}
