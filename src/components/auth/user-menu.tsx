'use client'

import { useSession, signOut } from 'next-auth/react'
import { useState, useRef, useEffect } from 'react'

export function UserMenu() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!session?.user) return null

  const initials = (session.user.name ?? session.user.email ?? '?')
    .split(' ')
    .map(s => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const image = session.user.image
  const isEmoji = image && !image.startsWith('http') && !image.startsWith('/')

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border hover:bg-muted/50 transition-colors"
      >
        {isEmoji ? (
          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-sm">
            {image}
          </div>
        ) : image ? (
          <img
            src={image}
            alt=""
            className="w-6 h-6 rounded-full"
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
            {initials}
          </div>
        )}
        <span className="text-sm font-medium max-w-[120px] truncate">
          {session.user.name ?? session.user.email}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border bg-popover shadow-lg z-50">
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-1">
              {isEmoji ? (
                <span className="text-lg">{image}</span>
              ) : image ? (
                <img src={image} alt="" className="w-8 h-8 rounded-full" />
              ) : null}
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
