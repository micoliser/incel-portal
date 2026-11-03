import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function TodoItemSkeleton() {
  return (
    <div className="flex items-start gap-3.5 p-3.5 sm:p-4 rounded-xl border border-border/70 bg-card">
      {/* Checkbox placeholder */}
      <Skeleton className="mt-0.5 size-5 sm:size-6 rounded-full flex-shrink-0" />

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-4 sm:h-5 w-2/5 rounded" />
          <Skeleton className="h-4 w-14 rounded flex-shrink-0" />
        </div>
        <Skeleton className="h-3.5 w-4/5 rounded" />
        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="size-8 rounded-lg" />
      </div>
    </div>
  );
}

export function TodoItemsListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <TodoItemSkeleton key={i} />
      ))}
    </div>
  );
}

export function TodosSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16 px-1 sm:px-4 max-w-full overflow-hidden">
      {/* Header Skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-44 rounded-lg" />
        <Skeleton className="h-4 w-80 max-w-full rounded" />
      </div>

      {/* Quick capture bar skeleton */}
      <Card className="p-3 sm:p-4 border border-border/80">
        <Skeleton className="h-10 w-full rounded-lg" />
      </Card>

      {/* Filter tab pills & search skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto p-1 rounded-lg border border-border/70 bg-muted/40">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-20 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-44 rounded-md" />
        </div>
      </div>

      {/* Items list skeleton */}
      <TodoItemsListSkeleton count={5} />
    </div>
  );
}

