import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export function InventoryDetailSkeleton() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Left Column (Item Details) */}
        <Card className="p-6 md:col-span-1 border border-border h-fit space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-full max-w-[150px]" />
            </div>
          ))}
          <div className="pt-4 border-t border-border">
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        </Card>

        {/* Right Column (Assignment History) */}
        <Card className="p-6 md:col-span-2 border border-border">
          <Skeleton className="h-7 w-48 mb-6" />
          
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border-b border-border pb-4 last:border-0 last:pb-0">
                <div className="flex justify-between items-start">
                  <div className="space-y-2 w-1/2">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                  <div className="space-y-2 flex flex-col items-end w-1/3">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
