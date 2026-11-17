'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  AuthShell,
  GoogleMark,
  OrDivider,
  authInputClass,
  authLabelClass,
  authPrimaryButtonClass,
  authSecondaryButtonClass,
} from '@/components/auth/auth-shell'

export default function RegisterPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/admin/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Registration failed')
        setLoading(false)
        return
      }

      // Auto-login after registration
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        // Registration succeeded but auto-login failed — surface the success on the login page
        // and prefill the email so the user doesn't think the register itself failed.
        setLoading(false)
        router.push(`/auth/login?registered=1&email=${encodeURIComponent(email)}`)
      } else {
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  const handleGoogleSignup = () => {
    if (loading) return
    setError('')
    setOauthLoading(true)
    setLoading(true)
    signIn('google', { callbackUrl: '/' })
  }

  return (
    <AuthShell title="Create your account" subtitle="Bring a PDF or an EPUB and start tracking it.">
        {error && (
          <div role="alert" aria-live="assertive" className="mb-5 rounded-md bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} aria-busy={loading} className="space-y-4">
          <div>
            <label htmlFor="name" className={authLabelClass}>Name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              required
              className={authInputClass}
            />
          </div>
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
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              className={authInputClass}
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className={authLabelClass}>Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className={authInputClass}
            />
          </div>
          <button type="submit" disabled={loading} className={`${authPrimaryButtonClass} mt-2`}>
            {loading && !oauthLoading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <OrDivider />

        <button
          onClick={handleGoogleSignup}
          disabled={loading}
          aria-busy={oauthLoading}
          className={authSecondaryButtonClass}
        >
          <GoogleMark />
          {oauthLoading ? 'Redirecting…' : 'Sign up with Google'}
        </button>

        <p className="mt-8 text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
    </AuthShell>
  )
}
