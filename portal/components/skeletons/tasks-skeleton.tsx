import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function TaskCardSkeleton() {
  return (
    <Card className="h-full w-full min-w-0 p-5 flex flex-col justify-between rounded-xl border border-border/80">
      <div className="space-y-3 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-4 w-12 rounded-md" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-3/4 rounded" />
          <Skeleton className="h-3.5 w-full rounded" />
          <Skeleton className="h-3.5 w-4/5 rounded" />
        </div>
      </div>

      <div className="mt-4 border-t border-border/70 pt-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3.5 w-24 rounded" />
          </div>
          <Skeleton className="h-3 w-14 rounded" />
        </div>

        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
          <Skeleton className="h-3.5 w-28 rounded" />
          <Skeleton className="size-3.5 rounded" />
        </div>
      </div>
    </Card>
  );
}

export function TasksSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 dark:border-border dark:bg-card/60">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="ml-1 h-9 w-32 rounded-md" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-12" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-md" />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-14" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20 rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 w-full min-w-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <TaskCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function TaskDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-32 rounded-lg" />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Main Column */}
        <div className="lg:col-span-8 space-y-6">
          <Card className="rounded-xl border border-border p-6 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
            <Skeleton className="h-8 w-3/4 rounded" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </Card>

          <Card className="rounded-xl border border-border p-6 space-y-6">
            <Skeleton className="h-6 w-44 rounded" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <div className="space-y-4 pt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-4">
                  <Skeleton className="size-8 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-16 w-full rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-4 space-y-5">
          <Card className="rounded-xl border border-border p-5 space-y-4">
            <Skeleton className="h-5 w-32 rounded" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </Card>

          <Card className="rounded-xl border border-border p-5 space-y-4">
            <Skeleton className="h-5 w-36 rounded" />
            <div className="space-y-3">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
