'use client'

import type * as React from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRightIcon } from 'lucide-react'
import { BrandLink } from '@/components/brand-link'
import { UserMenu } from '@/components/auth/user-menu'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'

type LinkGuard = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => void

const navLink =
  'inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground'

/**
 * Sticky top bar for the signed-in app (library, book, settings, marketplace).
 * The reader keeps its own toolbar. `actions` holds the page's own buttons.
 * `onInternalLinkClick` lets a page with unsaved edits (settings) intercept
 * the header's in-app links, which are soft navigations beforeunload misses.
 */
export function AppHeader({
  actions,
  className,
  current,
  onInternalLinkClick,
}: {
  actions?: ReactNode
  className?: string
  /** Which nav entry this page belongs to. 'library' covers book pages too. */
  current?: 'library'
  onInternalLinkClick?: LinkGuard
}) {
  const onLibrary = current === 'library'
  const guard = (href: string) =>
    onInternalLinkClick ? (e: React.MouseEvent<HTMLAnchorElement>) => onInternalLinkClick(e, href) : undefined

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65',
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <BrandLink onClick={guard('/')} />
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          <Link
            href="/"
            onClick={guard('/')}
            aria-current={onLibrary ? 'page' : undefined}
            className={cn(navLink, onLibrary && 'text-foreground')}
          >
            Library
          </Link>
          <a
            href="https://shanejli.com/knowledge"
            target="_blank"
            rel="noopener noreferrer"
            className={navLink}
          >
            Vocabulary
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5 opacity-60" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-2">
          {actions}
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
