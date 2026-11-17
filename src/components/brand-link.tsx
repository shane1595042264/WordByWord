import type * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/** The brand: the existing icon.svg mark plus the wordmark in the display face. */
export function BrandLink({
  href = '/',
  className,
  onClick,
}: {
  href?: string
  className?: string
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'group/brand flex w-fit items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG brand mark */}
      <img
        src="/icon.svg"
        alt=""
        width={28}
        height={28}
        className="size-7 rounded-[8px] transition-transform duration-300 ease-out group-hover/brand:-rotate-6 motion-reduce:transition-none dark:ring-1 dark:ring-white/15"
      />
      <span className="font-display text-[1.15rem] font-semibold tracking-tight">Nibbler</span>
    </Link>
  )
}
