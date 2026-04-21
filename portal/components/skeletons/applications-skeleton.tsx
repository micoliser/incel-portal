import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function ApplicationsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <Skeleton className="h-9 w-96" />
        <Skeleton className="h-5 w-full max-w-md" />
      </div>

      {/* Search and Filters Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            {/* Search */}
            <Skeleton className="h-10 w-full" />

            {/* Filter Buttons */}
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-24 rounded" />
              ))}
            </div>

            {/* Active Filters Display */}
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-32 rounded-full" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Info */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-9 w-32 rounded" />
      </div>

      {/* Applications Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardHeader className="pb-3 bg-muted">
              <div className="flex items-center justify-between">
                <Skeleton className="h-8 w-8 rounded" />
                <Skeleton className="h-5 w-20 rounded" />
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {/* App Name */}
              <Skeleton className="h-6 w-full mb-2" />

              {/* Description */}
              <Skeleton className="h-4 w-full mb-1" />
              <Skeleton className="h-4 w-4/5 mb-4" />

              {/* Status Badge */}
              <Skeleton className="h-5 w-16 mb-4 rounded-full" />

              {/* Access/Open Button */}
              <Skeleton className="h-9 w-full rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
