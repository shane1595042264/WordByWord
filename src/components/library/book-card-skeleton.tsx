import { Skeleton } from '@/components/ui/skeleton'

/** Same shape as BookCard: cover, title, author, progress line. */
export function BookCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 min-w-0" aria-hidden="true">
      <Skeleton className="aspect-[3/4] w-full rounded-sm" />
      <div className="space-y-1.5 px-0.5">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <div className="space-y-1.5 px-0.5">
        <Skeleton className="h-1 w-full rounded-full" />
        <div className="flex justify-between">
          <Skeleton className="h-2.5 w-7" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </div>
    </div>
  )
}
