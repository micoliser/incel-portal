import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ReportsCalendarSkeleton() {
  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="space-y-4 border-b border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-3">
                <Skeleton className="h-8 w-52" />
                <Skeleton className="h-4 w-72" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-20 rounded-md" />
                <Skeleton className="h-9 w-16 rounded-md" />
                <Skeleton className="h-9 w-20 rounded-md" />
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-7 gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {Array.from({ length: 7 }).map((_, index) => (
                <Skeleton key={index} className="h-8 rounded-md" />
              ))}
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
              {Array.from({ length: 35 }).map((_, index) => (
                <div
                  key={index}
                  className="min-h-28 rounded-2xl border border-border/60 bg-muted/20 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <Skeleton className="h-6 w-16 rounded-full" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-56" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader className="space-y-3">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-12 w-full rounded-2xl" />
              <Skeleton className="h-12 w-full rounded-2xl" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ReportDaySkeleton() {
  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <Skeleton className="h-9 w-24 rounded-md" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="space-y-4 border-b border-border/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-72" />
                </div>
              </div>

              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card
                    key={index}
                    className="border-border/60 bg-muted/30 shadow-none"
                  >
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-56" />
                        <Skeleton className="h-3 w-44" />
                      </div>
                      <Skeleton className="h-9 w-24 rounded-md" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-4 w-52" />
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function DailyReportSkeleton() {
  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <Skeleton className="h-9 w-32 rounded-md" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="space-y-4 border-b border-border/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-4 w-48" />
                </div>
                <Skeleton className="h-9 w-28 rounded-md" />
              </div>
            </div>

            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Card
                  key={index}
                  className="border-border/60 bg-muted/30 shadow-none transition-transform duration-200"
                >
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-52" />
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-9 w-20 rounded-md" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-40" />
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="space-y-2 rounded-2xl border border-border/60 p-4"
                >
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-9 w-24 rounded-md" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function SubreportSkeleton() {
  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <Skeleton className="h-9 w-36 rounded-md" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="space-y-4 border-b border-border/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <Skeleton className="h-8 w-72" />
                <Skeleton className="h-4 w-56" />
              </div>
              <Skeleton className="h-9 w-28 rounded-md" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-40" />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm dark:bg-slate-950/60"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-9 w-20 rounded-md" />
                  </div>
                  <Skeleton className="mt-3 h-4 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-6">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-4 w-40" />
            </CardHeader>
            <CardContent className="space-y-4 p-4 sm:p-6">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-full" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
