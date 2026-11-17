import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'
import { BrandLink } from '@/components/brand-link'

/** Shared field styling for the auth forms: label above, 40px input, visible focus. */
export const authInputClass =
  'h-10 w-full rounded-md border border-input bg-card px-3 text-foreground shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40'

export const authLabelClass = 'mb-1.5 block text-sm font-medium'

export const authPrimaryButtonClass =
  'h-10 w-full rounded-md bg-primary font-medium text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.14),0_1px_2px_oklch(0.3_0.06_165/0.18)] transition-[background-color,transform] hover:bg-primary/90 active:translate-y-px disabled:opacity-50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:active:translate-y-0'

export const authSecondaryButtonClass =
  'flex h-10 w-full items-center justify-center gap-2 rounded-md border bg-card font-medium shadow-xs transition-[background-color,transform] hover:bg-accent active:translate-y-px disabled:opacity-50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:active:translate-y-0'

/** Google's own multi-colour "G", as Google's sign-in guidelines require. */
export function GoogleMark() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

export function OrDivider() {
  return (
    <div className="relative my-6 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/**
 * A reading map, the same picture the book page draws: one square per
 * section, deep green when read, amber when started. Deterministic so the
 * server and client render the same squares.
 */
function ReadingMapTexture() {
  const cells = Array.from({ length: 168 }, (_, i) => {
    // Reads front to back with a few gaps and a frontier, like a real book.
    const h = (i * 2654435761) % 997
    if (i < 70) return h % 11 === 0 ? 'unread' : 'read'
    if (i < 92) return h % 3 === 0 ? 'read' : h % 5 === 0 ? 'progress' : 'unread'
    return h % 29 === 0 ? 'progress' : 'unread'
  })
  return (
    <div aria-hidden="true" className="grid grid-cols-[repeat(21,minmax(0,1fr))] gap-[5px]">
      {cells.map((state, i) => (
        <span
          key={i}
          className={`aspect-square rounded-[3px] ${
            state === 'read'
              ? 'bg-[oklch(0.78_0.12_160)]'
              : state === 'progress'
                ? 'bg-[oklch(0.8_0.135_78)]'
                : 'bg-white/10'
          }`}
        />
      ))}
    </div>
  )
}

/**
 * Sign-in / register frame: a brand panel on the left (lg and up) and the form
 * on the right. The panel is the same deep green in light and dark mode; it is
 * the brand surface, not a theme flip.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[oklch(0.27_0.05_166)] p-10 text-[oklch(0.96_0.012_160)] lg:flex xl:p-14">
        <BrandLink href="/welcome" className="text-[oklch(0.97_0.01_160)] focus-visible:ring-white/40" />
        <div className="max-w-md">
          <p className="font-display text-4xl font-semibold leading-[1.05] tracking-tight xl:text-5xl">
            Read the hard books all the way through.
          </p>
          <p className="mt-5 text-[15px] leading-relaxed text-[oklch(0.86_0.02_160)]">
            Nibbler splits each book into sections, keeps track of what you have read, and explains any word in the sentence it sits in.
          </p>
        </div>
        <div className="space-y-6">
          <ReadingMapTexture />
          <Link
            href="/welcome"
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-[oklch(0.86_0.02_160)] transition-colors hover:text-white outline-none focus-visible:ring-[3px] focus-visible:ring-white/40"
          >
            How Nibbler works
            <ArrowRightIcon aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <BrandLink href="/welcome" />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 mb-8 text-muted-foreground">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  )
}
