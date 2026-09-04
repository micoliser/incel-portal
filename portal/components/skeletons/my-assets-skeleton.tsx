import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function MyAssetsSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
      </div>

      {/* Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-6 h-48 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="space-y-2">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              
              <div className="rounded-md bg-muted/50 p-3 space-y-3">
                <Skeleton className="h-3 w-1/3" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-full ml-auto" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-full ml-auto" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
