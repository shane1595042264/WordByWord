'use client'

import { useEffect, useState, useCallback } from 'react'
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

const COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8']

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

  const dismiss = useCallback(() => {
    setVisible(false)
    setTimeout(onDismiss, 300)
  }, [onDismiss])

  // Auto-dismiss after 8 seconds
  useEffect(() => {
    const timer = setTimeout(dismiss, 8000)
    return () => clearTimeout(timer)
  }, [dismiss])

  // Dismiss on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dismiss() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [dismiss])

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={dismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Confetti particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
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
        className="relative z-10 bg-background border rounded-2xl p-8 max-w-md mx-4 text-center shadow-2xl animate-celebration-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-6xl mb-4">
          <span className="inline-block animate-bounce">&#127881;</span>
        </div>
        <h2 className="text-2xl font-bold mb-2">Congratulations!</h2>
        <p className="text-muted-foreground mb-1">You finished reading</p>
        <p className="text-lg font-semibold mb-6 line-clamp-2">{bookTitle}</p>
        <div className="flex items-center justify-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          </div>
          <span className="text-sm font-medium text-green-600 dark:text-green-400">100% Complete</span>
        </div>
        <Button onClick={dismiss} variant="outline" size="sm">
          Continue Reading
        </Button>
      </div>
    </div>
  )
}
