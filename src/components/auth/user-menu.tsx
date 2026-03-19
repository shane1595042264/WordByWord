'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'

const EMOJI_AVATARS = [
  '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦉', '🦋', '🐙',
  '🐢', '🦈', '🐬', '🦜', '🐝', '🦄', '🐲', '🌸', '🌻', '🍀',
  '🌈', '⭐', '🔥', '💎', '🎯', '🎨', '🎵', '🚀', '🌊', '🍄',
  '🎪', '🎭', '🧊', '🪐', '🌙', '☀️', '🍉', '🥑', '🧁', '🍩',
]

/** Deterministic emoji based on a string (email/name), so the same user always gets the same fallback. */
function emojiFromString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return EMOJI_AVATARS[Math.abs(hash) % EMOJI_AVATARS.length]
}

/** Check if a string is an emoji (not a URL or R2 key). */
function isEmojiAvatar(str: string | null | undefined): boolean {
  if (!str) return false
  return !str.startsWith('http') && !str.startsWith('/') && !str.startsWith('r2:')
}

export function UserMenu() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [resolvedAvatarUrl, setResolvedAvatarUrl] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Resolve R2 avatar keys by fetching the user profile from the backend
  const sessionImage = session?.user?.image
  useEffect(() => {
    if (!sessionImage || !sessionImage.startsWith('r2:')) {
      setResolvedAvatarUrl(null)
      return
    }

    // Image is an R2 key — resolve it via backend API
    let cancelled = false
    async function resolve() {
      try {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) return
        const { token } = await tokenRes.json()

        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
        const res = await fetch(`${apiUrl}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return

        const data = await res.json()
        if (!cancelled && data.avatarUrl && data.avatarUrl.startsWith('http')) {
          setResolvedAvatarUrl(data.avatarUrl)
        }
      } catch {
        // Silently fail — we'll show the emoji fallback
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [sessionImage])

  if (!session?.user) return null

  const initials = (session.user.name ?? session.user.email ?? '?')
    .split(' ')
    .map(s => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Determine what to display:
  // 1. If we resolved an R2 URL → show the image
  // 2. If session image is an emoji → show it
  // 3. If session image is an http URL → show it
  // 4. Otherwise → show a deterministic emoji fallback
  let displayImage: string
  let displayIsEmoji: boolean

  if (resolvedAvatarUrl) {
    displayImage = resolvedAvatarUrl
    displayIsEmoji = false
  } else if (sessionImage && isEmojiAvatar(sessionImage)) {
    displayImage = sessionImage
    displayIsEmoji = true
  } else if (sessionImage && (sessionImage.startsWith('http') || sessionImage.startsWith('/'))) {
    displayImage = sessionImage
    displayIsEmoji = false
  } else {
    // Fallback: deterministic emoji
    displayImage = emojiFromString(session.user.email ?? session.user.name ?? 'user')
    displayIsEmoji = true
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border hover:bg-muted/50 transition-colors"
      >
        {displayIsEmoji ? (
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm">
            {displayImage}
          </div>
        ) : (
          <img
            src={displayImage}
            alt=""
            className="w-6 h-6 rounded-full object-cover"
          />
        )}
        <span className="text-sm font-medium max-w-[120px] truncate">
          {session.user.name ?? session.user.email}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border bg-popover shadow-lg z-50">
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-1">
              {displayIsEmoji ? (
                <span className="text-lg">{displayImage}</span>
              ) : (
                <img src={displayImage} alt="" className="w-8 h-8 rounded-full object-cover" />
              )}
              <p className="text-sm font-medium truncate">{session.user.name}</p>
            </div>
            <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
            {(session.user as Record<string, unknown>).role === 'admin' && (
              <span className="inline-block mt-1 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">
                Admin
              </span>
            )}
          </div>
          <div className="p-1">
            <Link
              href="/vocabulary"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              Vocabulary
            </Link>
            {(session.user as Record<string, unknown>).role === 'admin' && (
              <Link
                href="/marketplace"
                onClick={() => setOpen(false)}
                className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
              >
                Marketplace
              </Link>
            )}
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              Settings
            </Link>
            <div className="my-1 border-t" />
            <button
              onClick={() => signOut({ callbackUrl: '/auth/login' })}
              className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-destructive"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
