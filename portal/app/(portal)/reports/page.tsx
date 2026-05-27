"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Users,
} from "lucide-react";

import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { reportsAPI, type ReportCalendarDay } from "@/lib/api/reports";

function buildMonthGrid(month: Date) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export default function ReportsPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => format(new Date(), "yyyy-MM"));
  const [calendarDays, setCalendarDays] = useState<ReportCalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMonth = async () => {
      try {
        setLoading(true);
        const data = await reportsAPI.getMonth(month);
        setCalendarDays(data.dates);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    };

    void loadMonth();
  }, [month]);

  const monthDate = useMemo(() => {
    const parsed = parseISO(`${month}-01`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [month]);

  const gridDays = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const reportMap = useMemo(
    () => new Map(calendarDays.map((item) => [item.report_date, item])),
    [calendarDays],
  );

  const goToDay = (date: Date) => {
    router.push(`/reports/${format(date, "yyyy-MM-dd")}`);
  };

  if (loading && calendarDays.length === 0) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/80 px-5 py-4 shadow-sm backdrop-blur">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">
            Loading report calendar...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <PageErrorCard
        title="Failed to load reports"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="space-y-4 border-b border-border/60">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-2xl">
                  {format(monthDate, "MMMM yyyy")}
                </CardTitle>
                <CardDescription>
                  Click a day to open the daily report hub.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMonth(format(subMonths(monthDate, 1), "yyyy-MM"))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMonth(format(new Date(), "yyyy-MM"))}
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setMonth(format(addMonths(monthDate, 1), "yyyy-MM"))
                  }
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-7 gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                (label) => (
                  <div key={label} className="px-3 py-2">
                    {label}
                  </div>
                ),
              )}
            </div>

            <div className="mt-3 grid grid-cols-7 gap-2">
              {gridDays.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const report = reportMap.get(dateKey);
                const inMonth = isSameMonth(date, monthDate);
                const today = isToday(date);
                const hasReports = report != null;
                const subreportCount =
                  report && report.has_your_report ? report.subreport_count : 0;

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => goToDay(date)}
                    className={[
                      "group relative min-h-28 rounded-2xl border p-3 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50",
                      inMonth
                        ? "hover:-translate-y-0.5 hover:shadow-md"
                        : "opacity-55 saturate-75",
                      inMonth
                        ? hasReports
                          ? "border-primary/30 bg-muted/30 text-slate-900 dark:border-primary/40 dark:bg-slate-900/50 dark:text-white"
                          : "border-border/70 bg-white/90 text-slate-900 dark:border-slate-800 dark:bg-slate-950/60 dark:text-white"
                        : "border-dashed border-border/50 bg-muted/10 text-slate-400 dark:border-slate-800/70 dark:bg-slate-900/20 dark:text-slate-500",
                      today ? "ring-2 ring-primary/30" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span
                        className={[
                          "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold",
                          today
                            ? "bg-primary text-primary-foreground"
                            : inMonth && hasReports
                              ? "bg-primary text-primary-foreground"
                              : inMonth
                                ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                : "bg-slate-100/60 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400",
                        ].join(" ")}
                      >
                        {format(date, "d")}
                      </span>
                      {report?.has_your_report && (
                        <span className="rounded-full bg-white/90 px-2 py-1 text-[11px] font-semibold text-primary shadow-sm dark:bg-slate-900/80">
                          {subreportCount} report
                          {subreportCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 space-y-2">
                      {hasReports ? (
                        <>
                          <p className="line-clamp-2 text-sm font-medium">
                            {report?.has_your_report
                              ? "You have a report here"
                              : "Department reports available"}
                          </p>
                          {report?.has_your_report ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Users className="h-3.5 w-3.5" />
                              <span>
                                {subreportCount} report
                                {subreportCount === 1 ? "" : "s"}
                              </span>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No reports found.
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <CalendarIcon className="h-5 w-5 text-primary" />
                Reports Hub
              </CardTitle>
              <CardDescription>
                Your month-at-a-glance view for daily reports.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                Open a date to review your report, the department view, and the
                reports nested underneath each day.
              </p>
              <Button className="w-full" asChild>
                <Link href={`/reports/${format(new Date(), "yyyy-MM-dd")}`}>
                  Open today
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex gap-3 rounded-xl bg-muted/60 p-3">
                <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <p>
                  Each date groups your report and everyone else in your
                  department.
                </p>
              </div>
              <div className="flex gap-3 rounded-xl bg-muted/60 p-3">
                <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <p>
                  Report pages show reports, and each report has its own comment
                  thread.
                </p>
              </div>
              <div className="flex gap-3 rounded-xl bg-muted/60 p-3">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <p>
                  Click a report card to go straight to its full detail page.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
