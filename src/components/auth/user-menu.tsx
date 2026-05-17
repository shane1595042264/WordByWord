'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useShortcut } from '@/hooks/use-shortcuts'

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
  const [resolving, setResolving] = useState(false)
  const [imgError, setImgError] = useState(false)

  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape key and trap focus within the dropdown
  useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
        return
      }

      if (e.key === 'Tab') {
        const focusable = menuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])'
        )
        if (!focusable || focusable.length === 0) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  // Resolve R2 avatar keys by fetching the user profile from the backend
  const sessionImage = session?.user?.image
  useEffect(() => {
    if (!sessionImage || !sessionImage.startsWith('r2:')) {
      setResolvedAvatarUrl(null)
      setResolving(false)
      return
    }

    // Image is an R2 key — resolve it via backend API
    let cancelled = false
    setResolving(true)
    setImgError(false)
    async function resolve() {
      try {
        const tokenRes = await fetch('/api/auth/token')
        if (!tokenRes.ok) throw new Error('token fetch failed')
        const { token } = await tokenRes.json()

        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'
        const res = await fetch(`${apiUrl}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('profile fetch failed')

        const data = await res.json()
        if (!cancelled && data.avatarUrl && data.avatarUrl.startsWith('http')) {
          setResolvedAvatarUrl(data.avatarUrl)
        }
      } catch {
        // Resolution failed — will show fallback emoji
      } finally {
        if (!cancelled) setResolving(false)
      }
    }
    resolve()
    return () => { cancelled = true }
  }, [sessionImage])

  // Reset image error when the URL changes
  // NOTE: This must be before any early returns to satisfy Rules of Hooks
  useEffect(() => { setImgError(false) }, [resolvedAvatarUrl, sessionImage])

  // Keyboard shortcut to toggle the dropdown menu
  const toggleMenu = useCallback(() => {
    setOpen(prev => !prev)
    if (!open) {
      // When opening via shortcut, focus the first menu item after render
      setTimeout(() => {
        const firstItem = menuRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])')
        firstItem?.focus()
      }, 0)
    } else {
      buttonRef.current?.focus()
    }
  }, [open])
  useShortcut('toggle-user-menu', 'User Menu', 'Ctrl+m', toggleMenu)

  if (!session?.user) return null

  const initials = (session.user.name ?? session.user.email ?? '?')
    .split(' ')
    .map(s => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  // Determine what to display:
  // 1. If actively resolving an R2 URL → show loading skeleton
  // 2. If we resolved an R2 URL → show the image
  // 3. If session image is an emoji → show it
  // 4. If session image is an http URL → show it
  // 5. Otherwise → show a deterministic emoji fallback
  let displayImage: string
  let displayIsEmoji: boolean
  let displayIsLoading = false

  if (resolving) {
    displayImage = ''
    displayIsEmoji = false
    displayIsLoading = true
  } else if (resolvedAvatarUrl && !imgError) {
    displayImage = resolvedAvatarUrl
    displayIsEmoji = false
  } else if (sessionImage && isEmojiAvatar(sessionImage)) {
    displayImage = sessionImage
    displayIsEmoji = true
  } else if (sessionImage && !imgError && (sessionImage.startsWith('http') || sessionImage.startsWith('/'))) {
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
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu-panel"
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border hover:bg-muted/50 transition-colors"
      >
        {displayIsLoading ? (
          <div className="w-6 h-6 rounded-full bg-muted animate-pulse" />
        ) : displayIsEmoji ? (
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm">
            {displayImage}
          </div>
        ) : (
          <img
            src={displayImage}
            alt=""
            className="w-6 h-6 rounded-full object-cover"
            onError={() => setImgError(true)}
          />
        )}
        <span className="text-sm font-medium max-w-[120px] truncate">
          {session.user.name ?? session.user.email}
        </span>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id="user-menu-panel"
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 rounded-lg border bg-popover shadow-lg z-50"
        >
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-1">
              {displayIsLoading ? (
                <div className="w-8 h-8 rounded-full bg-muted animate-pulse" />
              ) : displayIsEmoji ? (
                <span className="text-lg">{displayImage}</span>
              ) : (
                <img src={displayImage} alt="" className="w-8 h-8 rounded-full object-cover" onError={() => setImgError(true)} />
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
            <a
              href="https://shanejli.com/knowledge"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              Vocabulary ↗
            </a>
            {(session.user as Record<string, unknown>).role === 'admin' && (
              <Link
                href="/marketplace"
                role="menuitem"
                onClick={() => setOpen(false)}
                className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
              >
                Marketplace
              </Link>
            )}
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              Settings
            </Link>
            <div className="my-1 border-t" />
            <button
              role="menuitem"
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
