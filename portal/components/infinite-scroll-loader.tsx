import { Loader2 } from "lucide-react";

interface InfiniteScrollLoaderProps {
  isLoading: boolean;
  entityName?: string;
  className?: string;
}

export function InfiniteScrollLoader({
  isLoading,
  entityName = "items",
  className = "",
}: InfiniteScrollLoaderProps) {
  if (!isLoading) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2.5 py-6 text-xs font-medium text-muted-foreground animate-in fade-in duration-300 ${className}`}
    >
      <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
      <span>Loading more {entityName}...</span>
    </div>
  );
}

