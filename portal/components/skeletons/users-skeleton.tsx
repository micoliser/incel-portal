import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function UsersSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Filter / Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-full" />

            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-40 rounded-md" />
              <Skeleton className="h-10 w-28 rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="px-4 py-2 bg-muted">
          <div className="grid grid-cols-12 gap-4 w-full">
            <Skeleton className="h-4 rounded col-span-2" />
            <Skeleton className="h-4 rounded col-span-2" />
            <Skeleton className="h-4 rounded col-span-4" />
            <Skeleton className="h-4 rounded col-span-2" />
            <Skeleton className="h-4 rounded col-span-2" />
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="grid grid-cols-12 gap-4 px-4 py-3 border-b"
              >
                <Skeleton className="h-4 w-full col-span-2" />
                <Skeleton className="h-4 w-full col-span-2" />
                <Skeleton className="h-4 w-full col-span-4" />
                <Skeleton className="h-4 w-full col-span-2" />
                <Skeleton className="h-4 w-full col-span-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
