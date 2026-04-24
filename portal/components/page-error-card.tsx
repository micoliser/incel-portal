import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

interface PageErrorCardProps {
  title: string;
  message: string;
  onRetry: () => void;
  actions?: ReactNode;
}

export function PageErrorCard({
  title,
  message,
  onRetry,
  actions,
}: PageErrorCardProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] px-6">
      <div className="w-full max-w-md rounded-lg border border-red-200/50 bg-red-50/80 p-6 dark:border-red-900/50 dark:bg-red-950/40">
        <div className="flex items-start gap-4">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-red-900 dark:text-red-200">
              {title}
            </h2>
            <p className="mt-2 text-sm text-red-800 dark:text-red-300">
              {message}
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button
                onClick={onRetry}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Try again
              </Button>
              {actions}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
