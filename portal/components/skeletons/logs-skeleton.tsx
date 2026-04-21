import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function LogsTableSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="space-y-2 pb-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </CardHeader>
      </Card>

      {/* Filter Bar */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-28 rounded-md" />
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </div>

          <div className="flex gap-2">
            <Skeleton className="h-10 w-32 rounded-md" />
            <Skeleton className="h-10 w-24 rounded-md" />
          </div>
        </CardContent>
      </Card>

      {/* Table Container */}
      <Card>
        <CardContent className="pt-6">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 mb-4 px-4 py-2 bg-muted rounded-t-lg">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-4 rounded col-span-1"
                style={{
                  gridColumn:
                    i === 0 ? "span 1" : i === 1 ? "span 2" : "span 1",
                }}
              />
            ))}
          </div>

          {/* Table Rows */}
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-4 px-4 py-3 border-b"
              >
                {/* ID */}
                <Skeleton className="h-4 w-full col-span-1" />
                {/* Timestamp */}
                <Skeleton className="h-4 w-full col-span-2" />
                {/* Actor */}
                <Skeleton className="h-4 w-full col-span-1" />
                {/* Action */}
                <Skeleton className="h-4 w-full col-span-2" />
                {/* Target */}
                <Skeleton className="h-4 w-full col-span-2" />
                {/* IP */}
                <Skeleton className="h-4 w-full col-span-2" />
                {/* Metadata */}
                <Skeleton className="h-4 w-full col-span-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      <Card>
        <CardContent className="pt-6 flex items-center justify-between">
          <Skeleton className="h-4 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
