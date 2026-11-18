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
import { ReportsCalendarSkeleton } from "@/components/skeletons/reports-skeleton";
import { reportsAPI, type ReportCalendarDay } from "@/lib/api/reports";
import { extractApiErrorMessage } from "@/lib/api-errors";

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
        setError(extractApiErrorMessage(err, "Failed to load reports"));
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
    return <ReportsCalendarSkeleton />;
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
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-border bg-card shadow-sm">
          <CardHeader className="space-y-4 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-2xl font-bold tracking-tight">
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
            <div
              className="grid grid-cols-7 gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:gap-2 sm:text-xs"
              aria-hidden="true"
            >
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                <div key={label} className="py-2 text-center sm:px-3 sm:text-left">
                  <span className="sm:hidden">{label.charAt(0)}</span>
                  <span className="hidden sm:inline">{label}</span>
                </div>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-7 gap-1 sm:mt-3 sm:gap-2">
              {gridDays.map((date) => {
                const dateKey = format(date, "yyyy-MM-dd");
                const report = reportMap.get(dateKey);
                const inMonth = isSameMonth(date, monthDate);
                const today = isToday(date);
                const hasReports = report != null;
                const yours = Boolean(report?.has_your_report);
                const subreportCount = yours ? (report?.subreport_count ?? 0) : 0;
                const countLabel = `${subreportCount} report${subreportCount === 1 ? "" : "s"}`;
                const spoken = `${format(date, "EEEE d MMMM yyyy")}${today ? ", today" : ""}: ${
                  yours ? `your report, ${countLabel}` : hasReports ? "department reports" : "no reports"
                }`;

                return (
                  <button
                    key={dateKey}
                    type="button"
                    onClick={() => goToDay(date)}
                    aria-label={spoken}
                    className={[
                      "group relative flex min-h-14 flex-col items-center rounded-lg border p-1.5 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-24 sm:items-stretch sm:rounded-xl sm:p-2.5 lg:min-h-28",
                      inMonth
                        ? hasReports
                          ? "border-[#0d47a1]/35 bg-[#0d47a1]/5 text-foreground hover:border-[#0d47a1]/60"
                          : "border-border bg-card text-foreground hover:border-[#0d47a1]/40"
                        : "border-dashed border-border bg-muted/40 text-muted-foreground hover:border-border",
                      today ? "ring-2 ring-[#0d47a1]/40" : "",
                    ].join(" ")}
                  >
                    <div className="flex w-full items-start justify-center sm:justify-start">
                      <span
                        className={[
                          "inline-flex size-7 items-center justify-center rounded-md text-sm font-semibold tabular-nums sm:size-8 sm:rounded-lg",
                          today || (inMonth && hasReports)
                            ? "bg-[#0d47a1] text-white"
                            : inMonth
                              ? "bg-muted text-foreground"
                              : "text-muted-foreground",
                        ].join(" ")}
                      >
                        {format(date, "d")}
                      </span>
                    </div>

                    {/* Phone: a marker under the date. Wider: a short line of text. */}
                    {hasReports && (
                      <span
                        className={[
                          "mt-1.5 size-1.5 rounded-full sm:hidden",
                          yours ? "bg-success" : "bg-[#0d47a1] dark:bg-[#38bdf8]",
                        ].join(" ")}
                        aria-hidden="true"
                      />
                    )}
                    {hasReports && (
                      <p className="mt-2 hidden text-[11px] font-medium leading-snug sm:block">
                        {yours ? (
                          <>
                            <span className="block text-success-text">Your report</span>
                            <span className="block text-muted-foreground">{countLabel}</span>
                          </>
                        ) : (
                          "Department reports"
                        )}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:hidden">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
                Your report
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8]" aria-hidden="true" />
                Department reports
              </span>
            </p>
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
              <div className="space-y-2">
                <Button className="w-full" asChild>
                  <Link href={`/reports/${format(new Date(), "yyyy-MM-dd")}`}>
                    Open today
                  </Link>
                </Button>
                <Button className="w-full" variant="outline" asChild>
                  <Link href="/reports/all">
                    View all reports
                  </Link>
                </Button>
              </div>
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
