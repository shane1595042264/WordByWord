import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BookOpenTextIcon,
  ColumnsIcon,
  KeyboardIcon,
  LayersIcon,
  RefreshCwIcon,
  SigmaIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandLink } from '@/components/brand-link'
import { LandingNav } from '@/components/landing/landing-nav'
import { WordContextDemo } from '@/components/landing/word-context-demo'
import { ReadingMapDemo, ReadingMapStats } from '@/components/landing/reading-map-demo'

export const metadata: Metadata = {
  title: 'Read the hard books all the way through',
  description:
    'Nibbler tracks every section you read, explains any word in its sentence, and keeps your place on every device.',
}

const FEATURES = [
  {
    icon: LayersIcon,
    title: 'Sections, not page numbers',
    body: 'Nibbler reads the table of contents, or builds one with AI for scanned books, and splits every chapter into sections.',
  },
  {
    icon: BookOpenTextIcon,
    title: 'Read in any order',
    body: 'Jump straight to the chapter you need. Progress is kept per section, so skipping ahead never muddles anything.',
  },
  {
    icon: ColumnsIcon,
    title: 'The page, the text, or both',
    body: 'Read the original PDF, a clean text view, or the two side by side with your place marked in each.',
  },
  {
    icon: SigmaIcon,
    title: 'Math that survives',
    body: 'Formulas come through as typeset LaTeX instead of broken glyphs, so textbooks stay readable.',
  },
  {
    icon: KeyboardIcon,
    title: 'Keyboard first',
    body: 'Move by word, sentence or page without the mouse, and rebind any shortcut to suit your hands.',
  },
  {
    icon: RefreshCwIcon,
    title: 'On every device',
    body: 'Your library lives in the browser first and syncs in the background, so it keeps working offline.',
  },
]

export default function WelcomePage() {
  return (
    <div className="min-h-[100dvh] bg-background">
      <LandingNav />

      <main>
        {/* Hero: the promise on the left, the product working on the right. */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pt-10 pb-20 sm:px-6 md:pt-16 lg:grid-cols-[minmax(0,13fr)_minmax(0,11fr)] lg:gap-14 lg:pt-20 lg:pb-28">
          <div>
            <h1
              className="animate-rise-in max-w-[13ch] font-display text-[2.6rem] font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:max-w-none lg:text-[3.4rem] xl:text-[4rem]"
              style={{ '--rise-index': 0 } as React.CSSProperties}
            >
              Read the hard books all the way through.
            </h1>
            <p
              className="animate-rise-in mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground"
              style={{ '--rise-index': 1 } as React.CSSProperties}
            >
              Nibbler tracks every section you read, explains any word in its sentence, and keeps your place on every device.
            </p>
            <div
              className="animate-rise-in mt-9 flex flex-wrap items-center gap-3"
              style={{ '--rise-index': 2 } as React.CSSProperties}
            >
              <Button asChild size="lg" className="h-11 px-6 text-[15px]">
                <Link href="/auth/register">Create account</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-6 text-[15px]">
                <Link href="/auth/login">Sign in</Link>
              </Button>
            </div>
          </div>
          <div className="animate-rise-in lg:pl-4" style={{ '--rise-index': 3 } as React.CSSProperties}>
            <WordContextDemo />
          </div>
        </section>

        {/* The reading map: the visual leads this time, the words follow. */}
        <section className="border-y bg-surface-sunken">
          <div className="reveal-on-scroll mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20 lg:py-28">
            <div className="order-2 lg:order-1">
              <ReadingMapDemo />
              <p className="mt-3 text-xs text-muted-foreground">An example book. Hover a square to see its section.</p>
            </div>
            <div className="order-1 lg:order-2">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
                Know exactly what you have read.
              </h2>
              <p className="mt-4 max-w-md text-lg leading-relaxed text-muted-foreground">
                Every section is a square. Green is read, amber is started. Read in any order and the map keeps up.
              </p>
              <div className="mt-10 border-t pt-6">
                <ReadingMapStats />
              </div>
            </div>
          </div>
        </section>

        {/* What it does, as a plain two-column list. */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:gap-20">
            <h2 className="reveal-on-scroll max-w-sm font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Made for books you finish over months.
            </h2>
            <ul className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title} className="reveal-on-scroll border-t pt-6">
                  <Icon aria-hidden="true" className="size-5 text-primary" strokeWidth={1.75} />
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Closing call to action. */}
        <section className="px-4 pb-24 sm:px-6">
          <div className="reveal-on-scroll mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-xl bg-[oklch(0.27_0.05_166)] px-6 py-12 text-[oklch(0.96_0.012_160)] sm:px-12 sm:py-16 md:flex-row md:items-center">
            <div>
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Start with one book.</h2>
              <p className="mt-3 max-w-md text-[oklch(0.86_0.02_160)]">
                Upload a PDF or an EPUB. Nibbler builds the sections and you start reading.
              </p>
            </div>
            <Button
              asChild
              size="lg"
              className="h-11 shrink-0 bg-[oklch(0.96_0.012_160)] px-6 text-[15px] text-[oklch(0.25_0.05_166)] shadow-none hover:bg-white"
            >
              <Link href="/auth/register">Create account</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <BrandLink href="/welcome" className="text-foreground" />
          <div className="flex items-center gap-6">
            <Link href="/auth/login" className="hover:text-foreground">Sign in</Link>
            <span>&copy; {new Date().getFullYear()} Nibbler</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
