import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function InventorySkeleton() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32 rounded-md" />
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
      </div>

      {/* Table Card */}
      <Card className="overflow-hidden border border-border">
        <div className="overflow-x-auto">
          <div className="w-full text-left text-sm">
            {/* Table Header */}
            <div className="bg-muted/50 py-3 flex px-4">
              <Skeleton className="h-5 w-1/5 mr-4" />
              <Skeleton className="h-5 w-1/5 mr-4" />
              <Skeleton className="h-5 w-1/5 mr-4" />
              <Skeleton className="h-5 w-1/5 mr-4" />
              <Skeleton className="h-5 w-1/5" />
            </div>
            
            {/* Table Body */}
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="py-3 flex px-4">
                  <Skeleton className="h-5 w-1/5 mr-4" />
                  <Skeleton className="h-5 w-1/5 mr-4" />
                  <Skeleton className="h-5 w-1/5 mr-4" />
                  <Skeleton className="h-5 w-16 mr-4 rounded-full" />
                  <Skeleton className="h-5 w-1/5 ml-auto" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
