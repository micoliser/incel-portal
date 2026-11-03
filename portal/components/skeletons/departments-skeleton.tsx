import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function DepartmentsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-7 w-56 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>

      {/* Department Cards */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-5 border border-border/80">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-48 rounded" />
                  <Skeleton className="h-3.5 w-32 rounded" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-8 rounded-md" />
              </div>
            </div>

            {/* Units/teams inside department */}
            <div className="mt-4 pt-4 border-t border-border/60 pl-6 space-y-2.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-36 rounded" />
                <Skeleton className="h-6 w-20 rounded" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-6 w-20 rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

