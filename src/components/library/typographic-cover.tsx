import { cn } from '@/lib/utils'

/**
 * Stand-in cover for a book that has none: the title set in the display face.
 * The tone is picked from the title so a shelf of coverless books still varies,
 * and every tone stays inside the one green family.
 */
const TONES = [
  // pale green, ink title
  'bg-[linear-gradient(160deg,var(--accent),var(--muted)_75%)] text-accent-foreground [&_[data-cover-author]]:text-muted-foreground',
  // deep green, paper title
  'bg-[linear-gradient(160deg,oklch(0.36_0.07_165),oklch(0.27_0.05_166))] text-[oklch(0.95_0.02_160)] [&_[data-cover-author]]:text-[oklch(0.82_0.03_160)]',
  // stone, ink title
  'bg-[linear-gradient(160deg,var(--secondary),var(--muted)_80%)] text-foreground [&_[data-cover-author]]:text-muted-foreground',
  // mid green, paper title
  'bg-[linear-gradient(160deg,oklch(0.55_0.09_163),oklch(0.45_0.09_164))] text-[oklch(0.97_0.015_160)] [&_[data-cover-author]]:text-[oklch(0.9_0.03_160)]',
]

function toneFor(title: string): string {
  let hash = 0
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) | 0
  return TONES[Math.abs(hash) % TONES.length]
}

export function TypographicCover({
  title,
  author,
  size = 'md',
  className,
}: {
  title: string
  author?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'absolute inset-0 flex flex-col justify-between overflow-hidden',
        size === 'sm' ? 'p-1.5' : size === 'lg' ? 'p-4' : 'p-3',
        toneFor(title),
        className,
      )}
    >
      {size === 'sm' ? (
        <span className="font-display text-lg font-semibold leading-none">{title.trim().charAt(0).toUpperCase()}</span>
      ) : (
        <>
          <span
            className={cn(
              'font-display font-semibold leading-tight tracking-tight',
              size === 'lg' ? 'line-clamp-6 text-lg' : 'line-clamp-5 text-[15px]',
            )}
          >
            {title}
          </span>
          {author && (
            <span data-cover-author className={cn('line-clamp-2', size === 'lg' ? 'text-xs' : 'text-[11px]')}>
              {author}
            </span>
          )}
        </>
      )}
    </div>
  )
}
