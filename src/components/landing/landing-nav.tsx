'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { BrandLink } from '@/components/brand-link'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'

/** Public top bar. A signed-in visitor gets a way back to their library instead. */
export function LandingNav() {
  const { status } = useSession()

  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <BrandLink href="/welcome" />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          {status === 'authenticated' ? (
            <Button asChild>
              <Link href="/">Open library</Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/auth/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/auth/register">Create account</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
