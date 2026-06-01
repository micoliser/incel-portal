"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format, formatDistanceToNow, isToday, parseISO } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { useCallback } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  Loader2,
  Plus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReportDaySkeleton } from "@/components/skeletons/reports-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  reportsAPI,
  type DailyReportDetail,
  type DailyReportSummary,
  type ReportsDayResponse,
} from "@/lib/api/reports";

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

function ReportCard({ report }: { report: DailyReportSummary }) {
  return (
    <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{`Report for ${report.creator.full_name}`}</CardTitle>
            <CardDescription className="mt-1">
              {report.creator.full_name} · {report.department}
            </CardDescription>
          </div>
          <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {report.subreport_count} report
            {report.subreport_count === 1 ? "" : "s"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            {formatDistanceToNow(parseISO(report.created_at), {
              addSuffix: true,
            })}
          </p>
          <p>Report date: {report.report_date}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={report.view_url}>
            View report
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SubreportPreview({
  subreport,
  showReportLink,
}: {
  subreport: DailyReportDetail["subreports"][number];
  showReportLink?: boolean;
}) {
  return (
    <Card className="border-border/60 bg-muted/30 shadow-none transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-sm">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="space-y-1">
          <p className="font-semibold text-foreground">{subreport.title}</p>
          <p className="text-sm text-muted-foreground">
            {subreport.created_by.full_name} · {subreport.comments_count}{" "}
            comment
            {subreport.comments_count === 1 ? "" : "s"}
          </p>
          {subreport.latest_comment_at ? (
            <p className="text-xs text-muted-foreground">
              Latest comment{" "}
              {formatDistanceToNow(parseISO(subreport.latest_comment_at), {
                addSuffix: true,
              })}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {showReportLink ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/reports/daily/${subreport.daily_report_id}`}>
                Open report
              </Link>
            </Button>
          ) : null}
          <Button variant="outline" size="sm" asChild>
            <Link href={subreport.view_url}>View</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportDayPage() {
  const params = useParams();
  const router = useRouter();
  const reportDate = String(params.date);

  const [dayData, setDayData] = useState<ReportsDayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeSection, setActiveSection] = useState<
    "my-report" | "department"
  >("my-report");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const reportResponse = await reportsAPI.getDay(reportDate);
      setDayData(reportResponse);
      setShowCreateForm(false);
      setActiveSection(reportResponse.your_report ? "my-report" : "department");
      setLoadError(null);
      setActionError(null);
    } catch (err) {
      const message = extractApiErrorMessage(
        err,
        err instanceof Error ? err.message : "Failed to load report day",
      );
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [reportDate]);

  useEffect(() => {
    if (reportDate) {
      void loadData();
    }
  }, [loadData, reportDate]);

  const yourReport = dayData?.your_report ?? null;

  const parsedDate = useMemo(() => {
    const nextDate = parseISO(reportDate);
    return Number.isNaN(nextDate.getTime()) ? new Date() : nextDate;
  }, [reportDate]);

  const parsedDateIsToday = useMemo(() => isToday(parsedDate), [parsedDate]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedComment = comment.trim();

    if (!trimmedTitle) {
      setActionError("A report title is required.");
      return;
    }

    if (!trimmedComment) {
      setActionError("A comment is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setActionError(null);

      if (!parsedDateIsToday) {
        setActionError("You can only create reports for the current day.");
        return;
      }

      if (yourReport) {
        await reportsAPI.createSubreport(
          yourReport.id,
          trimmedTitle,
          trimmedComment,
        );
      } else {
        await reportsAPI.createForDay(reportDate, trimmedTitle, trimmedComment);
      }

      toast.success(yourReport ? "Report created." : "Daily report created.");
      setTitle("");
      setComment("");
      await loadData();
    } catch (err) {
      const message = extractApiErrorMessage(
        err,
        err instanceof Error ? err.message : "Failed to save the report",
      );
      setActionError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <ReportDaySkeleton />;
  }

  if (loadError || !dayData) {
    return (
      <PageErrorCard
        title="Failed to load report day"
        message={loadError || "No report data found."}
        onRetry={() => window.location.reload()}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/reports")}
          >
            Back to calendar
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/reports")}
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to calendar
      </Button>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-background/60 p-3 shadow-sm backdrop-blur sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={activeSection === "my-report" ? "default" : "outline"}
            onClick={() => setActiveSection("my-report")}
            className="rounded-full"
          >
            My report
            <span className="ml-2 rounded-full bg-background/20 px-2 py-0.5 text-xs">
              {yourReport ? yourReport.subreports.length : 0}
            </span>
          </Button>
          <Button
            type="button"
            variant={activeSection === "department" ? "default" : "outline"}
            onClick={() => setActiveSection("department")}
            className="rounded-full"
          >
            Department reports
            <span className="ml-2 rounded-full bg-background/20 px-2 py-0.5 text-xs">
              {dayData.all_reports.length}
            </span>
          </Button>
        </div>

        {activeSection === "my-report" ? (
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader className="space-y-3 border-b border-border/60">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-2xl">
                    {format(parsedDate, "EEEE, MMMM do")}
                  </CardTitle>
                </div>
                <div className="rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm dark:bg-slate-900/80">
                  {dayData.all_reports.length} report
                  {dayData.all_reports.length === 1 ? "" : "s"}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 p-4 sm:p-6">
              <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                      Your report
                    </p>
                    {yourReport ? (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {yourReport.creator.full_name} · {yourReport.department}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        No reports found for this date yet.
                      </p>
                    )}
                  </div>
                  {yourReport ? (
                    <Button variant="outline" asChild>
                      <Link href={yourReport.view_url}>Open full report</Link>
                    </Button>
                  ) : parsedDateIsToday ? (
                    <Button
                      type="button"
                      onClick={() => setShowCreateForm((current) => !current)}
                    >
                      {showCreateForm ? "Hide create form" : "Create report"}
                    </Button>
                  ) : null}
                </div>

                {yourReport ? (
                  <div className="mt-4 space-y-3">
                    {yourReport.subreports.length > 0 ? (
                      yourReport.subreports.map((subreport) => (
                        <SubreportPreview
                          key={subreport.id}
                          subreport={subreport}
                        />
                      ))
                    ) : (
                      <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                        No reports yet. Add the first one below.
                      </div>
                    )}
                  </div>
                ) : parsedDateIsToday && showCreateForm ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-4">
                    <form className="space-y-4" onSubmit={handleSubmit}>
                      <div className="space-y-2">
                        <Label htmlFor="report-title">Report title</Label>
                        <Input
                          id="report-title"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="What did you work on?"
                          disabled={isSubmitting}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="report-comment">Comment</Label>
                        <textarea
                          id="report-comment"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          rows={5}
                          placeholder="Add context, blockers, or progress notes."
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isSubmitting}
                        />
                      </div>

                      {actionError ? (
                        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{actionError}</span>
                        </div>
                      ) : null}

                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full gap-2"
                      >
                        {isSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        Create report
                      </Button>
                    </form>
                  </div>
                ) : !parsedDateIsToday ? (
                  <div className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No report has been created for this date.
                  </div>
                ) : null}
              </div>

              <Card className="border-border/60 shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg">
                    {parsedDateIsToday
                      ? yourReport
                        ? "Add to report"
                        : "No reports yet"
                      : "Reports"}
                  </CardTitle>
                  <CardDescription>
                    {parsedDateIsToday
                      ? yourReport
                        ? "Add a new item to your daily report."
                        : "Create a report above to unlock reports for this day."
                      : "Report creation is only available for the current day."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {yourReport && parsedDateIsToday ? (
                    <form className="space-y-4" onSubmit={handleSubmit}>
                      <div className="space-y-2">
                        <Label htmlFor="report-title">Report title</Label>
                        <Input
                          id="report-title"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder="What did you work on?"
                          disabled={isSubmitting}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="report-comment">Comment</Label>
                        <textarea
                          id="report-comment"
                          value={comment}
                          onChange={(event) => setComment(event.target.value)}
                          rows={5}
                          placeholder="Add context, blockers, or progress notes."
                          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isSubmitting}
                        />
                      </div>

                      {actionError ? (
                        <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                          <span>{actionError}</span>
                        </div>
                      ) : null}

                      <Button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full gap-2"
                      >
                        {isSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Plus className="h-4 w-4" />
                        )}
                        {yourReport ? "Add report" : "Create report"}
                      </Button>
                    </form>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      {parsedDateIsToday
                        ? "No report tools are available until you create a report for this day."
                        : "Viewing only. Report creation is disabled for non-current dates."}
                    </div>
                  )}
                </CardContent>
              </Card>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5 text-primary" />
                  All reports
                </CardTitle>
                <CardDescription>
                  Department reports for the selected day.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {dayData.all_reports.length > 0 ? (
                  dayData.all_reports.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No department reports yet.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg">Navigation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                  <Eye className="h-4 w-4 text-primary" />
                  <span>
                    Use the view button on any report to view the full report
                    page.
                  </span>
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                  <Users className="h-4 w-4 text-primary" />
                  <span>
                    Department members see each other&apos;s daily reports in
                    the all reports view.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
