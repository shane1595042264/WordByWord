'use client'

import { useState, useEffect } from 'react'
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

/** Check if a string is an emoji (not a URL) */
function isEmoji(str: string): boolean {
  return !str.startsWith('http') && !str.startsWith('/')
}

interface UserProfile {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  authRole: string
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

      // Update the NextAuth session so the UI reflects changes immediately
      await updateSession({
        name: updated.name,
        image: updated.avatarUrl,
      })

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

  const hasGoogleImage = profile?.avatarUrl && !isEmoji(profile.avatarUrl)

  return (
    <div className="space-y-6 mt-4">
      {/* Current avatar display */}
      <div className="space-y-2">
        <Label>Profile picture</Label>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-3xl overflow-hidden border-2 border-border">
            {selectedAvatar && isEmoji(selectedAvatar) ? (
              <span>{selectedAvatar}</span>
            ) : selectedAvatar ? (
              <img src={selectedAvatar} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-muted-foreground text-lg font-bold">?</span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            {hasGoogleImage ? (
              <p>You&apos;re using your Google profile picture. Pick an emoji below to replace it.</p>
            ) : (
              <p>Pick an emoji to use as your avatar.</p>
            )}
          </div>
        </div>
      </div>

      {/* Emoji picker grid */}
      <div className="space-y-2">
        <Label>Choose an emoji</Label>
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
        {hasGoogleImage && (
          <button
            type="button"
            onClick={() => setSelectedAvatar(profile!.avatarUrl!)}
            className="text-xs text-muted-foreground hover:underline mt-1"
          >
            Use my Google profile picture instead
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
    </div>
  )
}
