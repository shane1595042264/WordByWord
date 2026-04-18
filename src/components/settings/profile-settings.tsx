'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const EMOJI_OPTIONS = [
  '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦉', '🦋', '🐙',
  '🐢', '🦈', '🐬', '🦜', '🐝', '🦄', '🐲', '🌸', '🌻', '🍀',
  '🌈', '⭐', '🔥', '💎', '🎯', '🎨', '🎵', '🚀', '🌊', '🍄',
  '🎪', '🎭', '🧊', '🪐', '🌙', '☀️', '🍉', '🥑', '🧁', '🍩',
]

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Check if a string is an emoji (not a URL or R2 key). */
function isEmoji(str: string): boolean {
  return !str.startsWith('http') && !str.startsWith('/') && !str.startsWith('r2:')
}

interface UserProfile {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  authRole: string
  hasPassword: boolean
}

export function ProfileSettings() {
  const { data: session, update: updateSession } = useSession()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [name, setName] = useState('')
  const [selectedAvatar, setSelectedAvatar] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [imgError, setImgError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchProfile()
  }, [])

  async function getToken(): Promise<string | null> {
    try {
      const res = await fetch('/api/auth/token')
      if (!res.ok) return null
      const { token } = await res.json()
      return token
    } catch {
      return null
    }
  }

  async function fetchProfile() {
    try {
      const token = await getToken()
      if (!token) {
        setError('Not authenticated')
        setLoading(false)
        return
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
      const res = await fetch(`${apiUrl}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch profile')

      const data: UserProfile = await res.json()
      setProfile(data)
      setName(data.name ?? '')
      setSelectedAvatar(data.avatarUrl ?? '')
      setLoading(false)
    } catch (err) {
      setError('Failed to load profile')
      setLoading(false)
    }
  }

  async function handleAvatarUpload(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('Image must be under 2 MB.')
      return
    }

    setUploading(true)
    setError(null)
    setImgError(false)

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${apiUrl}/users/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) throw new Error('Failed to upload avatar')

      const { avatarUrl, r2Key } = await res.json()
      setSelectedAvatar(avatarUrl)

      // Also update profile state so "current" reflects the upload
      if (profile) {
        setProfile({ ...profile, avatarUrl })
      }

      // Store the R2 key in the session (matches DB) so avatar resolution
      // works consistently across page navigations and re-logins
      await updateSession({ image: r2Key ?? avatarUrl })
    } catch (err) {
      setError('Failed to upload image. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleAvatarUpload(file)
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    setError(null)

    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')

      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
      const body: Record<string, string> = {}
      if (name !== (profile.name ?? '')) body.name = name
      if (selectedAvatar !== (profile.avatarUrl ?? '')) body.avatarUrl = selectedAvatar

      if (Object.keys(body).length === 0) {
        setSaving(false)
        return
      }

      const avatarChanged = body.avatarUrl !== undefined

      const res = await fetch(`${apiUrl}/users/me`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) throw new Error('Failed to update profile')

      const updated: UserProfile = await res.json()
      setProfile(updated)
      setName(updated.name ?? '')
      setSelectedAvatar(updated.avatarUrl ?? '')

      // Only update session image when avatar was actually changed.
      // When unchanged, keep the existing R2 key in the session to avoid
      // overwriting it with a presigned URL that will expire.
      const sessionUpdate: Record<string, unknown> = { name: updated.name }
      if (avatarChanged) {
        sessionUpdate.image = updated.avatarUrl
      }
      await updateSession(sessionUpdate)

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading profile...</div>
  }

  if (error && !profile) {
    return <div className="text-sm text-destructive py-4">{error}</div>
  }

  const hasExistingImage = profile?.avatarUrl && !isEmoji(profile.avatarUrl)
  const showingEmoji = !selectedAvatar || isEmoji(selectedAvatar)

  return (
    <div className="space-y-6 mt-4">
      {/* Current avatar display */}
      <div className="space-y-2">
        <Label>Profile picture</Label>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-3xl overflow-hidden border-2 border-border">
            {selectedAvatar && isEmoji(selectedAvatar) ? (
              <span>{selectedAvatar}</span>
            ) : selectedAvatar && !imgError ? (
              <img src={selectedAvatar} alt="" className="w-full h-full object-cover" onError={() => setImgError(true)} />
            ) : (
              <span className="text-muted-foreground text-lg font-bold">?</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            <p>Upload a photo or pick an emoji below.</p>
          </div>
        </div>
      </div>

      {/* Upload photo */}
      <div className="space-y-2">
        <Label>Upload a photo</Label>
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? 'Uploading...' : 'Choose Image'}
          </Button>
          <span className="text-xs text-muted-foreground">JPEG, PNG, or WebP. Max 2 MB.</span>
        </div>
      </div>

      {/* Emoji picker grid */}
      <div className="space-y-2">
        <Label>Or choose an emoji</Label>
        <div className="grid grid-cols-10 gap-1">
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setSelectedAvatar(emoji)}
              className={`w-9 h-9 text-lg rounded-md flex items-center justify-center transition-all hover:bg-muted ${
                selectedAvatar === emoji
                  ? 'bg-primary/20 ring-2 ring-primary'
                  : 'bg-background'
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
        {hasExistingImage && showingEmoji && (
          <button
            type="button"
            onClick={() => { setSelectedAvatar(profile!.avatarUrl!); setImgError(false) }}
            className="text-xs text-muted-foreground hover:underline mt-1"
          >
            Use my uploaded picture instead
          </button>
        )}
      </div>

      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="profile-name">Display name</Label>
        <Input
          id="profile-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={100}
        />
      </div>

      {/* Email (read-only) */}
      <div className="space-y-2">
        <Label>Email</Label>
        <p className="text-sm text-muted-foreground">{profile?.email}</p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Profile'}
      </Button>

      {profile && (
        <PasswordSection
          hasPassword={profile.hasPassword}
          onPasswordSet={() => setProfile({ ...profile, hasPassword: true })}
          getToken={getToken}
        />
      )}
    </div>
  )
}

function PasswordSection({
  hasPassword,
  onPasswordSet,
  getToken,
}: {
  hasPassword: boolean
  onPasswordSet: () => void
  getToken: () => Promise<string | null>
}) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleSubmit() {
    setErr(null)
    if (newPassword.length < 6) { setErr('Password must be at least 6 characters.'); return }
    if (newPassword !== confirmPassword) { setErr('Passwords do not match.'); return }
    if (hasPassword && !currentPassword) { setErr('Enter your current password.'); return }

    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
      const body: Record<string, string> = { newPassword }
      if (hasPassword) body.currentPassword = currentPassword
      const res = await fetch(`${apiUrl}/users/me/password`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.message ?? 'Failed to update password')
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
      onPasswordSet()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Failed to update password')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border-t pt-6 space-y-3">
      <div>
        <Label className="text-base">{hasPassword ? 'Change password' : 'Set a password'}</Label>
        <p className="text-xs text-muted-foreground mt-1">
          {hasPassword
            ? 'Update your password for signing in with email.'
            : 'You signed up with Google. Set a password to also sign in with email + password.'}
        </p>
      </div>
      {hasPassword && (
        <div className="space-y-1">
          <Label htmlFor="current-password" className="text-xs">Current password</Label>
          <Input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="new-password" className="text-xs">New password</Label>
        <Input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          placeholder="At least 6 characters"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="confirm-password" className="text-xs">Confirm new password</Label>
        <Input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={handleSubmit} disabled={submitting} variant="outline">
        {submitting ? 'Saving...' : success ? 'Password updated!' : hasPassword ? 'Update password' : 'Set password'}
      </Button>
    </div>
  )
}
