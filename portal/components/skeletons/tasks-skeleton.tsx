import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function TaskCardSkeleton() {
  return (
    <Card className="h-full w-full min-w-0 p-5 flex flex-col justify-between border border-border/80">
      <div className="space-y-3 min-w-0">
        <div className="flex items-start justify-between gap-3 min-w-0">
          <Skeleton className="h-5 w-3/4 rounded" />
          <Skeleton className="h-5 w-16 rounded flex-shrink-0" />
        </div>
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-4/5 rounded" />
      </div>

      <div className="mt-4 space-y-2 border-t border-border pt-3">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-14 rounded" />
            <Skeleton className="h-3.5 w-24 rounded" />
          </div>
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-14 rounded" />
            <Skeleton className="h-3.5 w-28 rounded" />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 border-t border-dashed border-border/60">
          <Skeleton className="h-4 w-12 rounded" />
          <Skeleton className="h-3.5 w-20 rounded" />
        </div>
      </div>
    </Card>
  );
}

export function TasksSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 dark:border-slate-700 dark:bg-slate-900/60">
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
    <div className="space-y-8">
      <Skeleton className="h-5 w-28" />

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-36" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-52" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Skeleton className="mx-auto h-6 w-40" />
        <div className="space-y-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mx-auto flex w-full max-w-2xl gap-4">
              <Skeleton className="h-5 w-5 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
