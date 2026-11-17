'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { CheckIcon, PartyPopperIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Particle {
  id: number
  x: number
  y: number
  color: string
  size: number
  rotation: number
  delay: number
}

// The brand's greens and the "in progress" amber, plus paper white.
const COLORS = ['#2f7a5b', '#4fa37f', '#8fd1b0', '#e8b84a', '#f2d48a', '#f4f7f5', '#1f5a43', '#c9e9d8']

const TITLE_ID = 'book-complete-celebration-title'

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: -10 - Math.random() * 20,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    size: 6 + Math.random() * 8,
    rotation: Math.random() * 360,
    delay: Math.random() * 1.5,
  }))
}

interface BookCompleteCelebrationProps {
  bookTitle: string
  onDismiss: () => void
}

export function BookCompleteCelebration({ bookTitle, onDismiss }: BookCompleteCelebrationProps) {
  const [particles] = useState(() => generateParticles(60))
  const [visible, setVisible] = useState(true)
  const [mounted, setMounted] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)

  // Read onDismiss through a ref so `dismiss` stays stable across renders and the
  // auto-dismiss timer below is armed exactly once instead of on every caller render.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss }, [onDismiss])

  const dismiss = useCallback(() => {
    setVisible(false)
    setTimeout(() => onDismissRef.current(), 300)
  }, [])

  // Portal target only exists in the browser
  useEffect(() => { setMounted(true) }, [])

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(dismiss, 8000)
    return () => clearTimeout(timer)
  }, [dismiss])

  // Move focus into the card, take the rest of the page out of the a11y tree and
  // the tab order, then restore both on dismiss.
  useEffect(() => {
    if (!mounted) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const root = rootRef.current
    const inerted: HTMLElement[] = []

    for (const el of Array.from(document.body.children)) {
      if (el === root || !(el instanceof HTMLElement)) continue
      if (el.hasAttribute('inert') || el.getAttribute('aria-hidden') === 'true') continue
      el.setAttribute('inert', '')
      el.setAttribute('aria-hidden', 'true')
      inerted.push(el)
    }

    continueRef.current?.focus()

    return () => {
      for (const el of inerted) {
        el.removeAttribute('inert')
        el.removeAttribute('aria-hidden')
      }
      previouslyFocused?.focus?.()
    }
  }, [mounted])

  // Escape dismisses; Tab cycles inside the card
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismiss()
        return
      }
      if (e.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusable = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) {
        e.preventDefault()
        return
      }
      const active = document.activeElement
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (active === first || !card.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !card.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => document.removeEventListener('keydown', handleKey, true)
  }, [dismiss])

  if (!mounted) return null

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={dismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[oklch(0.16_0.02_170/0.55)] backdrop-blur-sm" />

      {/* Confetti particles - decorative only */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div
            key={p.id}
            className="absolute animate-confetti-fall"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size * 0.6,
              backgroundColor: p.color,
              borderRadius: '2px',
              transform: `rotate(${p.rotation}deg)`,
              animationDelay: `${p.delay}s`,
            }}
          />
        ))}
      </div>

      {/* Center card */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="relative z-10 bg-popover text-popover-foreground border rounded-xl p-8 max-w-md mx-4 text-center shadow-[0_30px_80px_-20px_oklch(0.16_0.04_170/0.5)] animate-celebration-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-accent text-primary" aria-hidden="true">
          <PartyPopperIcon className="size-8 animate-bounce" strokeWidth={1.75} />
        </div>
        <h2 id={TITLE_ID} className="font-display text-3xl font-semibold tracking-tight mb-2">Congratulations!</h2>
        <p className="text-muted-foreground mb-1">You finished reading</p>
        <p className="font-reading text-lg font-medium italic mb-6 line-clamp-2">{bookTitle}</p>
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="size-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
            <CheckIcon aria-hidden="true" className="size-4" strokeWidth={3} />
          </div>
          <span className="text-sm font-medium text-primary">100% Complete</span>
        </div>
        <Button ref={continueRef} onClick={dismiss} variant="outline" size="sm">
          Continue Reading
        </Button>
      </div>
    </div>,
    document.body
  )
}
