"use client";
import { extractApiErrorMessage } from "@/lib/api-errors";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Calendar,
  Share2,
  Copy,
  Check,
  TrendingUp,
  FileText,
  MessageSquare,
  Clock,
  ChevronLeft,
  ChevronRight,
  Eye,
} from "lucide-react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { PageErrorCard } from "@/components/page-error-card";
import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import {
  summariesAPI,
  WeeklySummary,
  AvailableWeek,
  type ComparisonMetrics,
  type SharedWeeklySummary,
} from "@/lib/api/summaries";
import { goalsAPI, type GoalRecord } from "@/lib/api/goals";
import { MemoizedSummaryComparison } from "./components/SummaryComparison";
import { MemoizedSummaryCharts } from "./components/SummaryCharts";
import { MemoizedWeeklyGoalsSnapshot } from "./components/WeeklyGoalsSnapshot";
import ShareWithUserModal from "./components/ShareWithUserModal";
import type { AxiosError } from "axios";

function SummariesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shareToken = searchParams.get("token");
  const summaryId = searchParams.get("id");
  const isSharedView = !!shareToken;
  const mainContentRef = useRef<HTMLDivElement | null>(null);

  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [shareConfirmOpen, setShareConfirmOpen] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);
  const [, setLoadingShareStatus] = useState(false);
  const [shareWithUserOpen, setShareWithUserOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [comparisonMetrics, setComparisonMetrics] =
    useState<ComparisonMetrics | null>(null);
  const [goalsForWeek, setGoalsForWeek] = useState<GoalRecord[]>([]);
  const [historicalSummaries, setHistoricalSummaries] = useState<
    WeeklySummary[]
  >([]);
  const [exporting, setExporting] = useState(false);

  // Fetch available weeks on mount (only for non-shared view)
  useEffect(() => {
    if (isSharedView) {
      // For shared view, fetch the shared summary directly
      if (!shareToken) {
        setError("Invalid or missing share token");
        setLoading(false);
        return;
      }

      const fetchSharedSummary = async () => {
        try {
          setLoading(true);
          const data = await summariesAPI.getSharedSummary(shareToken);
          const sharedSummary = data.summary as SharedWeeklySummary | undefined;
          // data: { summary, historical? }
          setSummary(sharedSummary || null);
          // set comparison metrics if present
          if (sharedSummary?.comparison_metrics) {
            setComparisonMetrics(sharedSummary.comparison_metrics);
          }
          setHistoricalSummaries(data.historical || []);
          try {
            const goalData = await goalsAPI.getGoalsForWeek(
              sharedSummary?.week_start_date ?? "",
            );
            setGoalsForWeek(goalData.goals || []);
          } catch {
            setGoalsForWeek([]);
          }
          setError(null);
        } catch (err) {
          const error = err as AxiosError<{ detail?: string }>;
          if (
            error.response?.status === 403 ||
            error.response?.status === 404
          ) {
            setError(extractApiErrorMessage(err, "Invalid share link"));
          } else {
            setError(extractApiErrorMessage(err, "Failed to load the shared summary"));
          }
          setSummary(null);
        } finally {
          setLoading(false);
        }
      };

      fetchSharedSummary();
    } else {
      // For normal view, fetch available weeks
      const fetchWeeks = async () => {
        try {
          const weeks = await summariesAPI.getAvailableWeeks();
          setAvailableWeeks(weeks);

          if (weeks.length > 0) {
            // Auto-select the most recent week, or prefer URL param if present
            if (summaryId) {
              setSelectedWeek(summaryId);
            } else {
              setSelectedWeek(weeks[0].week_start_date);
            }
          }
        } catch {
          setError("Failed to load available weeks");
        } finally {
          setLoading(false);
        }
      };

      fetchWeeks();
    }
  }, [isSharedView, shareToken, summaryId]);

  // Fetch summary when selected week changes
  useEffect(() => {
    if (!selectedWeek) return;

    // Load public share status for selected week
    (async () => {
      try {
        setLoadingShareStatus(true);
        const status = await summariesAPI.getShareStatus(selectedWeek);
        if (status?.shared && status.share_token) {
          setShares((prev) => ({
            ...prev,
            [selectedWeek]: `/summaries?token=${status.share_token}`,
          }));
        } else {
          setShares((prev) => {
            const copy = { ...prev };
            delete copy[selectedWeek];
            return copy;
          });
        }
      } catch {
        // ignore
      } finally {
        // no-op
      }
    })();

    mainContentRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const summaryData = await summariesAPI.getSummary(selectedWeek);
        setSummary(summaryData);
        setError(null);

        // Fetch Phase 2 data (comparisons, goals, goal progress)
        try {
          // Fetch comparison metrics if available
          const comparison =
            await summariesAPI.getComparisonMetrics(selectedWeek);
          setComparisonMetrics(comparison);
        } catch {
          // Comparison may not exist for first week
          setComparisonMetrics(null);
        }

        try {
          // Fetch historical summaries (last 4 weeks) for charts
          const historical = await summariesAPI.getHistoricalSummaries(
            selectedWeek,
            4,
          );
          setHistoricalSummaries(historical || []);
        } catch {
          setHistoricalSummaries([]);
        }

        try {
          const goalData = await goalsAPI.getGoalsForWeek(selectedWeek);
          setGoalsForWeek(goalData.goals || []);
        } catch {
          setGoalsForWeek([]);
        }
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load summary for the selected week"));
        console.error(err);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [selectedWeek]);

  const handleCreateShare = async () => {
    if (!selectedWeek) return;

    try {
      setCreatingShare(true);
      const response = await summariesAPI.createShareLink(selectedWeek);
      // Build frontend-friendly share link that points to the consolidated summaries page
      const frontendPath = `/summaries?token=${response.share_token}`;
      setShares((prev) => ({
        ...prev,
        [selectedWeek]: frontendPath,
      }));
      toast.success("Share link created! Copy it to share.");
      setShareConfirmOpen(false);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to create share link"));
      console.error(err);
    } finally {
      setCreatingShare(false);
    }
  };

  const handleCopyLink = (link: string) => {
    const fullLink = `${window.location.origin}${link}`;
    navigator.clipboard.writeText(fullLink);
    setCopiedToken(link);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const getPriorityBadgeClasses = (priority: string) => {
    if (priority === "high") {
      return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200";
    }

    if (priority === "medium") {
      return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-200";
    }

    return "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200";
  };

  const getStatusBadgeClasses = (status: string) => {
    if (status === "completed") {
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200";
    }

    if (status === "in_progress") {
      return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200";
    }

    return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200";
  };

  if (loading && !isSharedView && availableWeeks.length === 0) {
    return <DashboardSkeleton />;
  }

  if (loading && isSharedView) {
    return <DashboardSkeleton />;
  }

  if (error && !summary) {
    if (isSharedView) {
      return (
        <PageErrorCard
          title="Cannot Load Summary"
          message={error}
          onRetry={() => window.location.reload()}
        />
      );
    }
    return (
      <PageErrorCard
        title="Failed to Load Summary"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!isSharedView && availableWeeks.length === 0) {
    return (
      <div className="container mx-auto py-10">
        <Card className="bg-blue-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900">
          <CardHeader>
            <CardTitle className="text-blue-900 dark:text-blue-300">
              No Summaries Yet
            </CardTitle>
            <CardDescription className="text-blue-700 dark:text-blue-400">
              Weekly summaries are generated every Monday. Check back next week!
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const gridTemplateColumns = isSharedView
    ? "0px minmax(0, 1fr)"
    : sidebarCollapsed
      ? "3rem minmax(0, 1fr)"
      : "16rem minmax(0, 1fr)";

  return (
    <div
      className="grid h-[calc(100dvh-14rem)] bg-transparent transition-[grid-template-columns] duration-200 ease-out will-change-[grid-template-columns] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-9rem)]"
      style={{ gridTemplateColumns }}
    >
      {/* Sidebar - Week Navigation (only for non-shared view) */}
      {!isSharedView && (
        <aside
          className={`z-20 flex h-[calc(100dvh-14rem)] w-full flex-col overflow-hidden border-r border-t border-sidebar-border bg-sidebar text-sidebar-foreground dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(9,15,26,0.98)_0%,rgba(4,8,15,0.98)_100%)] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-9rem)]`}
        >
          {/* Toggle Button */}
          <div
            className={`flex items-center border-b border-sidebar-border py-3 dark:border-slate-700/70 ${
              sidebarCollapsed ? "justify-center px-1" : "justify-between px-3"
            }`}
          >
            {!sidebarCollapsed && (
              <span className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                Weeks
              </span>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="ml-auto rounded-lg p-1 transition-transform duration-150 hover:bg-muted dark:hover:bg-slate-700/50"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-5 h-5" />
              ) : (
                <ChevronLeft className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Week List - Scrollable */}
          <div className="flex-1 overflow-y-auto px-2 py-3 pt-3">
            {availableWeeks.length > 0 ? (
              <div className="space-y-1">
                {availableWeeks.map((week) => (
                  <button
                    key={week.week_start_date}
                    onClick={() => {
                      const url = shareToken
                        ? `/summaries?id=${week.week_start_date}&token=${shareToken}`
                        : `/summaries?id=${week.week_start_date}`;
                      router.push(url);
                      setSelectedWeek(week.week_start_date);
                    }}
                    className={`w-full rounded-lg transition-colors ${
                      selectedWeek === week.week_start_date
                        ? "bg-accent text-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground"
                    } ${sidebarCollapsed ? "flex items-center justify-center p-2" : "text-left px-3 py-3"}`}
                    title={
                      sidebarCollapsed
                        ? `Week ${format(parseISO(week.week_start_date), "dd/MM/yy")} - ${format(parseISO(week.week_end_date), "dd/MM/yy")}`
                        : undefined
                    }
                  >
                    {sidebarCollapsed ? (
                      <Calendar className="w-5 h-5 shrink-0" />
                    ) : (
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 shrink-0" />
                        <div className="text-sm">
                          Week{" "}
                          {format(parseISO(week.week_start_date), "dd/MM/yy")} -{" "}
                          {format(parseISO(week.week_end_date), "dd/MM/yy")}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div
                className={`text-sm text-gray-600 dark:text-slate-400 ${sidebarCollapsed ? "hidden" : "p-4"}`}
              >
                No weeks available yet
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main Content */}
      <div ref={mainContentRef} className="col-start-2 min-w-0 overflow-y-auto">
        <div className="space-y-8 p-8">
          {/* Shared View Header (only shown for shared) */}
          {isSharedView && summary && (
            <div className="space-y-2 mb-8">
              <h1 className="text-4xl font-bold dark:text-white">
                {summary.user_name}
                {"'s"} Weekly Summary
              </h1>
              <p className="text-gray-600 dark:text-slate-400 flex items-center space-x-2">
                <Calendar className="w-4 h-4" />
                <span>
                  {format(parseISO(summary.week_start_date), "MMMM d")} -{" "}
                  {format(parseISO(summary.week_end_date), "MMMM d, yyyy")}
                </span>
              </p>
            </div>
          )}

          {/* Summary Content - Loading, Error, No Week Selected, or Loaded */}
          {loading && !summary ? (
            <DashboardSkeleton />
          ) : error && !summary ? (
            <PageErrorCard
              title="Cannot Load Summary"
              message={error}
              onRetry={() => window.location.reload()}
            />
          ) : !selectedWeek && !isSharedView ? (
            <Card className="bg-blue-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900">
              <CardHeader>
                <CardTitle className="text-blue-900 dark:text-blue-300">
                  Select a Week
                </CardTitle>
                <CardDescription className="text-blue-700 dark:text-blue-400">
                  Choose a week from the sidebar to view its summary.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : summary ? (
            <>
              {/* Summary Message - conditional display */}
              <h1 className="text-xl text-gray-800 dark:text-slate-200">
                {summary.summary_message}
              </h1>

              {/* Export Button */}
              {!isSharedView && (
                <div className="mt-3 mb-4">
                  <Button
                    onClick={async () => {
                      if (!selectedWeek) return;
                      try {
                        setExporting(true);
                        const resp = await summariesAPI.exportSummary(
                          selectedWeek,
                          "pdf",
                        );
                        if (resp?.file_url) {
                          // Trigger browser download
                          const a = document.createElement("a");
                          a.href = resp.file_url;
                          a.target = "_blank";
                          a.rel = "noopener noreferrer";
                          // If filename desired, browser will use content-disposition
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                          toast.success("Export started — downloading PDF");
                        } else {
                          toast.error("Export failed: no file returned");
                        }
                      } catch (err) {
                        const error = err as AxiosError<{ detail?: string }>;
                        if (error.response?.data?.detail) {
                          toast.error(
                            `Export failed: ${error.response.data.detail}`,
                          );
                        } else {
                          toast.error(extractApiErrorMessage(err, "Failed to export summary to PDF"));
                        }
                      } finally {
                        setExporting(false);
                      }
                    }}
                    disabled={exporting}
                    size="sm"
                  >
                    {exporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Exporting...
                      </>
                    ) : (
                      "Export to PDF"
                    )}
                  </Button>
                </div>
              )}

              {/* Main Stats Grid - Same for both views */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      Tasks Created
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.tasks_created}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      This week
                    </p>
                  </CardContent>
                </Card>
                <Dialog
                  open={revokeConfirmOpen}
                  onOpenChange={setRevokeConfirmOpen}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Revoke Share Link</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to revoke the share link? Users
                        with the previous link will no longer be able to view
                        this summary.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-3 justify-end pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setRevokeConfirmOpen(false)}
                        disabled={isRevoking}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={async () => {
                          if (!selectedWeek) return;
                          try {
                            setIsRevoking(true);
                            const resp =
                              await summariesAPI.revokeShare(selectedWeek);
                            if (resp?.revoked) {
                              setShares((prev) => {
                                const copy = { ...prev };
                                delete copy[selectedWeek];
                                return copy;
                              });
                              toast.success("Share link revoked");
                              setRevokeConfirmOpen(false);
                            } else {
                              toast.error("Failed to revoke share");
                            }
                          } catch (e) {
                            console.error(e);
                            toast.error("Failed to revoke share");
                          } finally {
                            setIsRevoking(false);
                          }
                        }}
                        disabled={isRevoking}
                      >
                        {isRevoking ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Revoking...
                          </>
                        ) : (
                          "Revoke"
                        )}
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      Tasks Completed
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.tasks_completed}/{summary.tasks_assigned}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      {summary.completion_rate_percent}% completion rate
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      On-Time Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.on_time_completion_rate_percent}%
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      {summary.on_time_completion_rate_percent >= 80
                        ? "Great work!"
                        : "Room for improvement"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Engagement Metrics - Same for both views */}
              <Card>
                <CardHeader>
                  <CardTitle>Engagement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <MessageSquare className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Comments Added
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.comments_added}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-green-500 dark:text-green-400" />
                        <div className="flex items-center gap-1">
                          <span className="text-gray-700 dark:text-slate-300">
                            Files Attached
                          </span>
                          {summary.id && (
                            <Link
                              href={
                                isSharedView && shareToken
                                  ? `/summaries/${summary.id}/files?v=sent&token=${shareToken}`
                                  : `/summaries/${summary.id}/files?v=sent`
                              }
                            >
                              <Eye className="h-4 w-4 text-green-500 dark:text-green-400 cursor-pointer hover:text-green-700 dark:hover:text-green-300" />
                            </Link>
                          )}
                        </div>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.files_attached}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                        <div className="flex items-center gap-1">
                          <span className="text-gray-700 dark:text-slate-300">
                            Files Received
                          </span>
                          {summary.id && (
                            <Link
                              href={
                                isSharedView && shareToken
                                  ? `/summaries/${summary.id}/files?v=received&token=${shareToken}`
                                  : `/summaries/${summary.id}/files?v=received`
                              }
                            >
                              <Eye className="h-4 w-4 text-blue-500 dark:text-blue-400 cursor-pointer hover:text-blue-700 dark:hover:text-blue-300" />
                            </Link>
                          )}
                        </div>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.files_received}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Clock className="w-5 h-5 text-purple-500 dark:text-purple-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Active Recurring Schedules
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.active_recurring_schedules}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <TrendingUp className="w-5 h-5 text-orange-500 dark:text-orange-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Schedules Created
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.recurring_schedules_created}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Daily Reports */}
              <Card>
                <CardHeader>
                  <CardTitle>Daily Reports</CardTitle>
                  <CardDescription>
                    {summary.daily_reports_created} daily report
                    {summary.daily_reports_created === 1 ? "" : "s"} created
                    this week.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {summary.daily_reports?.length > 0 ? (
                    <div className="space-y-3">
                      {summary.daily_reports.map((dailyReport) => (
                        <div
                          key={`${dailyReport.report_date}-${dailyReport.view_url}`}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 p-4"
                        >
                          <div className="space-y-1">
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {format(
                                parseISO(dailyReport.report_date),
                                "EEEE, MMM d",
                              )}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {dailyReport.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="rounded-full bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                              {dailyReport.subreport_count} report
                              {dailyReport.subreport_count === 1 ? "" : "s"}
                            </span>
                            <Button variant="outline" size="sm" asChild>
                              <Link href={dailyReport.view_url}>Open</Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      No daily reports were captured for this week.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Priority Distribution - Same for both views */}
              <Card>
                <CardHeader>
                  <CardTitle>Task Breakdown</CardTitle>
                  <CardDescription>
                    {isSharedView
                      ? "Tasks by priority and status"
                      : "Your tasks by priority and status"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-sm mb-3">
                        By Priority
                      </h3>
                      <div className="space-y-2">
                        {Object.entries(summary.priority_distribution).map(
                          ([priority, count]) => (
                            <div
                              key={priority}
                              className="flex items-center justify-between gap-3"
                            >
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getPriorityBadgeClasses(priority)}`}
                              >
                                {priority}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-slate-100">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm mb-3">By Status</h3>
                      <div className="space-y-2">
                        {Object.entries(summary.status_distribution).map(
                          ([status, count]) => (
                            <div
                              key={status}
                              className="flex items-center justify-between gap-3"
                            >
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClasses(status)}`}
                              >
                                {status === "in_progress"
                                  ? "In Progress"
                                  : status === "completed"
                                    ? "Completed"
                                    : "Pending"}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-slate-100">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Phase 2: Week-over-Week Comparison */}
              {comparisonMetrics &&
                Object.keys(comparisonMetrics).length > 0 && (
                  <MemoizedSummaryComparison
                    current={summary}
                    comparison={comparisonMetrics}
                  />
                )}

              {/* Phase 2: Analytics Charts */}
              <MemoizedSummaryCharts
                summaryData={summary}
                historicalData={historicalSummaries}
              />

              {/* Phase 2: Goal Tracker */}
              {!isSharedView && (
                <MemoizedWeeklyGoalsSnapshot
                  title="Goals for This Week"
                  description="Goals you created for this week are displayed here."
                  goals={goalsForWeek}
                  emptyStateTitle="No goals were created for this week"
                  emptyStateDescription="You did not create goals during this week."
                />
              )}

              {/* Share Section - only for non-shared view */}
              {!isSharedView && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Share2 className="w-5 h-5" />
                      <span>Share This Summary</span>
                    </CardTitle>
                    <CardDescription>
                      Create a public link to share your summary with others
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      <Button
                        onClick={() => setShareWithUserOpen(true)}
                        variant="outline"
                        size="sm"
                      >
                        Share with user
                      </Button>
                    </div>
                    <ShareWithUserModal
                      open={shareWithUserOpen}
                      onClose={() => setShareWithUserOpen(false)}
                      weekStartDate={selectedWeek || ""}
                      onShared={(userId) => {
                        // optional: show feedback or update UI
                        console.log("shared with", userId);
                      }}
                    />
                    {shares[selectedWeek || ""] ? (
                      <div className="flex space-x-2 items-center">
                        <input
                          type="text"
                          value={`${window.location.origin}${shares[selectedWeek || ""]}`}
                          readOnly
                          className="flex-1 px-3 py-2 border rounded-md bg-gray-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCopyLink(shares[selectedWeek || ""])
                          }
                        >
                          {copiedToken === shares[selectedWeek || ""] ? (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRevokeConfirmOpen(true)}
                          disabled={isRevoking}
                        >
                          {isRevoking ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Revoking...
                            </>
                          ) : (
                            "Revoke"
                          )}
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          onClick={() => setShareConfirmOpen(true)}
                          disabled={creatingShare}
                          className="w-full"
                        >
                          <Share2 className="w-4 h-4 mr-2" />
                          {creatingShare ? "Creating..." : "Create Share Link"}
                        </Button>

                        <Dialog
                          open={shareConfirmOpen}
                          onOpenChange={setShareConfirmOpen}
                        >
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Share Summary Publicly</DialogTitle>
                              <DialogDescription>
                                Are you sure you want to share this summary to
                                public? Everyone with the share link will be
                                able to view this summary if you confirm
                              </DialogDescription>
                            </DialogHeader>
                            <div className="flex gap-3 justify-end pt-4">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setShareConfirmOpen(false)}
                                disabled={creatingShare}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void handleCreateShare()}
                                disabled={creatingShare}
                              >
                                {creatingShare ? (
                                  <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Creating...
                                  </>
                                ) : (
                                  "Confirm"
                                )}
                              </Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SummariesPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <SummariesContent />
    </Suspense>
  );
}
