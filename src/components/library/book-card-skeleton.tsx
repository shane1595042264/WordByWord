import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function BookCardSkeleton() {
  return (
    <Card className="h-full overflow-hidden">
      <CardContent className="p-4 flex flex-col gap-3 min-w-0">
        {/* Cover image placeholder */}
        <Skeleton className="aspect-[3/4] w-full rounded-md" />

        {/* Title and author */}
        <div className="space-y-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>

        {/* Progress section */}
        <div className="space-y-1">
          <div className="flex justify-between">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      </CardContent>
    </Card>
  )
}
