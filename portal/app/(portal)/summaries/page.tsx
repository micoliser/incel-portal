"use client";

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
  Download,
  Paperclip,
  Inbox,
  Repeat,
  CheckSquare2,
  AlertCircle,
  Loader2,
  ArrowRight,
  UserPlus,
  Sparkles,
} from "lucide-react";
import type { AxiosError } from "axios";

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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageErrorCard } from "@/components/page-error-card";
import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";
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
          setSummary(sharedSummary || null);
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
            setError(
              extractApiErrorMessage(err, "Failed to load the shared summary"),
            );
          }
          setSummary(null);
        } finally {
          setLoading(false);
        }
      };

      fetchSharedSummary();
    } else {
      const fetchWeeks = async () => {
        try {
          const weeks = await summariesAPI.getAvailableWeeks();
          setAvailableWeeks(weeks);

          if (weeks.length > 0) {
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

    (async () => {
      try {
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
      }
    })();

    mainContentRef.current?.scrollTo({ top: 0, behavior: "smooth" });

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const summaryData = await summariesAPI.getSummary(selectedWeek);
        setSummary(summaryData);
        setError(null);

        try {
          const comparison =
            await summariesAPI.getComparisonMetrics(selectedWeek);
          setComparisonMetrics(comparison);
        } catch {
          setComparisonMetrics(null);
        }

        try {
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
        setError(
          extractApiErrorMessage(
            err,
            "Failed to load summary for the selected week",
          ),
        );
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
    toast.success("Share link copied to clipboard");
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleExportPDF = async () => {
    if (!selectedWeek) return;
    try {
      setExporting(true);
      const resp = await summariesAPI.exportSummary(selectedWeek, "pdf");
      if (resp?.file_url) {
        const a = document.createElement("a");
        a.href = resp.file_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
        toast.success("PDF summary downloaded");
      } else {
        toast.error("Export failed: no document generated");
      }
    } catch (err) {
      toast.error(
        extractApiErrorMessage(err, "Failed to export summary to PDF"),
      );
    } finally {
      setExporting(false);
    }
  };

  const getPriorityBadgeClasses = (priority: string) => {
    if (priority === "high") {
      return "border border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400";
    }
    if (priority === "medium") {
      return "border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    }
    return "border border-border bg-muted/60 text-muted-foreground";
  };

  const getStatusBadgeClasses = (status: string) => {
    if (status === "completed") {
      return "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    }
    if (status === "in_progress") {
      return "border border-[#0d47a1]/25 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]";
    }
    return "border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  };

  if (loading && !isSharedView && availableWeeks.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto p-6 sm:p-8">
        <DashboardSkeleton />
      </div>
    );
  }

  if (loading && isSharedView) {
    return (
      <div className="h-full w-full overflow-y-auto p-6 sm:p-8">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="h-full w-full overflow-y-auto p-6 sm:p-8">
        <PageErrorCard
          title="Cannot Load Summary"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (!isSharedView && availableWeeks.length === 0) {
    return (
      <div className="h-full w-full overflow-y-auto p-6 sm:p-8">
        <div className="container mx-auto py-12">
          <Card className="border-border/80 bg-card p-8 text-center shadow-xs">
            <Calendar className="mx-auto size-12 text-[#0d47a1] dark:text-[#38bdf8]" />
            <h2 className="mt-4 text-xl font-bold tracking-tight text-foreground">
              No Weekly Summaries Available
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Weekly performance summaries are compiled every Monday at midnight. Check back next week to view historical progress!
            </p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar - Week Navigation */}
      {!isSharedView && (
        <aside
          className={cn(
            "z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-border/80 bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out",
            sidebarCollapsed ? "w-14" : "w-64 sm:w-72",
          )}
        >
          {/* Sidebar Header & Toggle */}
          <div
            className={cn(
              "flex h-12 shrink-0 items-center border-b border-border/80",
              sidebarCollapsed ? "justify-center px-1" : "justify-between px-3.5",
            )}
          >
            {!sidebarCollapsed && (
              <div className="flex items-center gap-2">
                <Calendar className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Weekly History
                </span>
              </div>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
          </div>

          {/* Week Items List */}
          <div className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {availableWeeks.map((week, idx) => {
                const isSelected = selectedWeek === week.week_start_date;
                const startDate = parseISO(week.week_start_date);
                const endDate = parseISO(week.week_end_date);

                return (
                  <button
                    key={week.week_start_date}
                    onClick={() => {
                      const url = shareToken
                        ? `/summaries?id=${week.week_start_date}&token=${shareToken}`
                        : `/summaries?id=${week.week_start_date}`;
                      router.push(url);
                      setSelectedWeek(week.week_start_date);
                    }}
                    className={`w-full rounded-xl transition-all duration-150 ${
                      isSelected
                        ? "bg-[#0d47a1] text-white shadow-xs font-semibold"
                        : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground"
                    } ${sidebarCollapsed ? "flex items-center justify-center p-2.5" : "text-left px-3 py-2.5"}`}
                    title={
                      sidebarCollapsed
                        ? `Week: ${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`
                        : undefined
                    }
                  >
                    {sidebarCollapsed ? (
                      <Calendar className="size-4 shrink-0" />
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium tabular-nums">
                            {format(startDate, "MMM d")} – {format(endDate, "MMM d, yyyy")}
                          </p>
                          {idx === 0 && (
                            <span
                              className={`mt-0.5 inline-block text-[10px] uppercase font-bold tracking-wider ${
                                isSelected ? "text-white/80" : "text-[#0d47a1] dark:text-[#38bdf8]"
                              }`}
                            >
                              Most Recent
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <span className="size-2 rounded-full bg-white ml-2 shrink-0" />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>
      )}

      {/* Main Content Pane */}
      <div
        ref={mainContentRef}
        className="flex-1 min-w-0 h-full overflow-y-auto overflow-x-hidden bg-background"
      >
        <div className="mx-auto w-full max-w-6xl space-y-8 p-6 sm:p-8 lg:p-10 pb-20">
          {/* Header Strip */}
          {summary ? (
            <div className="flex flex-col gap-4 border-b border-border/70 pb-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/50 px-3 py-1 text-xs font-medium text-foreground">
                    <Calendar className="size-3.5 text-muted-foreground" />
                    <span className="tabular-nums">
                      {format(parseISO(summary.week_start_date), "MMMM d")} –{" "}
                      {format(parseISO(summary.week_end_date), "MMMM d, yyyy")}
                    </span>
                  </span>
                  {isSharedView && (
                    <span className="inline-flex items-center rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
                      Shared Report
                    </span>
                  )}
                </div>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  {isSharedView
                    ? `${summary.user_name}'s Weekly Summary`
                    : summary.summary_message || "Weekly Summary"}
                </h1>
              </div>

              {/* Action Buttons */}
              {!isSharedView && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button
                    onClick={handleExportPDF}
                    disabled={exporting}
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1.5 rounded-lg text-xs"
                  >
                    {exporting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    <span>{exporting ? "Exporting..." : "Export PDF"}</span>
                  </Button>
                </div>
              )}
            </div>
          ) : null}

          {summary ? (
            <>
              {/* Primary KPI Metrics Strip */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card className="border-border/80 bg-card p-5 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>Task Completion</span>
                    <CheckSquare2 className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums text-foreground">
                      {summary.tasks_completed}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      / {summary.tasks_assigned} assigned
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[#0d47a1] dark:bg-[#38bdf8] transition-all duration-500"
                        style={{
                          width: `${Math.min(summary.completion_rate_percent, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {summary.completion_rate_percent}% completion rate
                    </p>
                  </div>
                </Card>

                <Card className="border-border/80 bg-card p-5 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>On-Time Rate</span>
                    <Clock className="size-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums text-foreground">
                      {summary.on_time_completion_rate_percent}%
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-500"
                        style={{
                          width: `${Math.min(summary.on_time_completion_rate_percent, 100)}%`,
                        }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {summary.on_time_completion_rate_percent >= 80
                        ? "Exemplary turnaround time"
                        : "Focus on deadline milestones"}
                    </p>
                  </div>
                </Card>

                <Card className="border-border/80 bg-card p-5 shadow-xs">
                  <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    <span>Tasks Created</span>
                    <Sparkles className="size-4 text-amber-500" />
                  </div>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="text-3xl font-bold tabular-nums text-foreground">
                      {summary.tasks_created}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      new initiatives
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full w-full rounded-full bg-amber-500" />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Initiated during this reporting cycle
                    </p>
                  </div>
                </Card>
              </div>

              {/* Engagement & Files Sub-Pages Gateway */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    Activity & File Exchanges
                  </h2>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Files Attached (Sent) Card - Direct Link to Subpage */}
                  <Link
                    href={
                      isSharedView && shareToken
                        ? `/summaries/${summary.id}/files?v=sent&token=${shareToken}`
                        : `/summaries/${summary.id}/files?v=sent`
                    }
                    className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4.5 shadow-xs transition-all hover:border-[#0d47a1]/50 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                          <Paperclip className="size-4.5" />
                        </div>
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          View
                          <ArrowRight className="size-3" />
                        </span>
                      </div>
                      <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                        {summary.files_attached}
                      </p>
                      <p className="text-xs font-semibold text-foreground">
                        Files Attached
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Documents & assets sent by you
                      </p>
                    </div>
                  </Link>

                  {/* Files Received Card - Direct Link to Subpage */}
                  <Link
                    href={
                      isSharedView && shareToken
                        ? `/summaries/${summary.id}/files?v=received&token=${shareToken}`
                        : `/summaries/${summary.id}/files?v=received`
                    }
                    className="group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4.5 shadow-xs transition-all hover:border-[#0d47a1]/50 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                          <Inbox className="size-4.5" />
                        </div>
                        <span className="text-xs font-medium text-[#0d47a1] dark:text-[#38bdf8] group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                          View
                          <ArrowRight className="size-3" />
                        </span>
                      </div>
                      <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                        {summary.files_received}
                      </p>
                      <p className="text-xs font-semibold text-foreground">
                        Files Received
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Incoming files from collaborators
                      </p>
                    </div>
                  </Link>

                  {/* Comments Added Card */}
                  <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4.5 shadow-xs">
                    <div>
                      <div className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
                        <MessageSquare className="size-4.5" />
                      </div>
                      <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                        {summary.comments_added}
                      </p>
                      <p className="text-xs font-semibold text-foreground">
                        Comments Added
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Collaboration updates logged
                      </p>
                    </div>
                  </div>

                  {/* Recurring Schedules Card */}
                  <div className="flex flex-col justify-between rounded-xl border border-border/80 bg-card p-4.5 shadow-xs">
                    <div>
                      <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                        <Repeat className="size-4.5" />
                      </div>
                      <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
                        {summary.active_recurring_schedules}
                      </p>
                      <p className="text-xs font-semibold text-foreground">
                        Active Schedules
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {summary.recurring_schedules_created} created this week
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Daily Reports Section */}
              <Card className="border-border/80 bg-card shadow-xs">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base font-semibold">
                        Daily Reports Captured
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {summary.daily_reports_created} daily update
                        {summary.daily_reports_created === 1 ? "" : "s"} submitted
                        this week
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {summary.daily_reports?.length > 0 ? (
                    <div className="divide-y divide-border/60">
                      {summary.daily_reports.map((dailyReport) => (
                        <div
                          key={`${dailyReport.report_date}-${dailyReport.view_url}`}
                          className="flex flex-wrap items-center justify-between gap-3 py-3"
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-semibold text-foreground">
                              {format(
                                parseISO(dailyReport.report_date),
                                "EEEE, MMMM d, yyyy",
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {dailyReport.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium tabular-nums text-muted-foreground">
                              {dailyReport.subreport_count} subreport
                              {dailyReport.subreport_count === 1 ? "" : "s"}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg text-xs"
                              asChild
                            >
                              <Link href={dailyReport.view_url}>
                                Open Report
                              </Link>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                      No daily reports were filed during this week cycle.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Task Breakdown (Priority & Status) */}
              <Card className="border-border/80 bg-card shadow-xs">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Task Distribution
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Categorization by priority level and execution lifecycle
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                        By Priority Level
                      </p>
                      <div className="space-y-2.5">
                        {Object.entries(summary.priority_distribution).map(
                          ([priority, count]) => (
                            <div
                              key={priority}
                              className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                            >
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${getPriorityBadgeClasses(priority)}`}
                              >
                                {priority}
                              </span>
                              <span className="font-bold tabular-nums text-foreground">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
                        By Status
                      </p>
                      <div className="space-y-2.5">
                        {Object.entries(summary.status_distribution).map(
                          ([status, count]) => (
                            <div
                              key={status}
                              className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
                            >
                              <span
                                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClasses(status)}`}
                              >
                                {status === "in_progress"
                                  ? "In Progress"
                                  : status === "completed"
                                    ? "Completed"
                                    : "Pending"}
                              </span>
                              <span className="font-bold tabular-nums text-foreground">
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

              {/* Week-over-Week Comparison */}
              {comparisonMetrics &&
                Object.keys(comparisonMetrics).length > 0 && (
                  <MemoizedSummaryComparison
                    current={summary}
                    comparison={comparisonMetrics}
                  />
                )}

              {/* Analytics & Trends Charts */}
              <MemoizedSummaryCharts
                summaryData={summary}
                historicalData={historicalSummaries}
              />

              {/* Goal Tracker Snapshot for this week */}
              {!isSharedView && (
                <MemoizedWeeklyGoalsSnapshot
                  title="Weekly Goals Record"
                  description="Performance against the targets you set for this week."
                  goals={goalsForWeek}
                  emptyStateTitle="No goals recorded for this week"
                  emptyStateDescription="Goals established during this week cycle will appear here."
                />
              )}

              {/* Share & Collaboration Section */}
              {!isSharedView && (
                <Card className="border-border/80 bg-card shadow-xs">
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                        <Share2 className="size-4.5" />
                      </div>
                      <div>
                        <CardTitle className="text-base font-semibold">
                          Share This Summary
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Share this weekly summary with colleagues or generate a public link
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-1">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setShareWithUserOpen(true)}
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5 text-xs"
                      >
                        <UserPlus className="size-3.5" />
                        Share with user
                      </Button>
                    </div>

                    {shares[selectedWeek || ""] ? (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input
                          type="text"
                          value={`${window.location.origin}${shares[selectedWeek || ""]}`}
                          readOnly
                          className="h-9 flex-1 rounded-lg border border-border bg-muted/40 px-3 text-xs text-foreground tabular-nums select-all focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleCopyLink(shares[selectedWeek || ""])
                            }
                            className="h-9 text-xs"
                          >
                            {copiedToken === shares[selectedWeek || ""] ? (
                              <>
                                <Check className="mr-1.5 size-3.5 text-emerald-600" />
                                Copied
                              </>
                            ) : (
                              <>
                                <Copy className="mr-1.5 size-3.5" />
                                Copy Link
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setRevokeConfirmOpen(true)}
                            disabled={isRevoking}
                            className="h-9 text-xs"
                          >
                            Revoke Link
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Button
                          onClick={() => setShareConfirmOpen(true)}
                          disabled={creatingShare}
                          className="bg-[#0d47a1] text-white hover:bg-[#0a3880] text-xs h-9"
                        >
                          <Share2 className="mr-2 size-3.5" />
                          {creatingShare ? "Creating Link..." : "Create Public Share Link"}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </div>
      </div>

      {/* Share Modals & Dialogs */}
      <ShareWithUserModal
        open={shareWithUserOpen}
        onClose={() => setShareWithUserOpen(false)}
        weekStartDate={selectedWeek || ""}
      />

      <Dialog open={shareConfirmOpen} onOpenChange={setShareConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Share2 className="size-4.5" />}>
            <DialogTitle>Create Public Share Link</DialogTitle>
            <DialogDescription>
              This creates a view-only share link. Anyone with this link will be able to review this weekly summary report without an account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end gap-2">
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
              onClick={() => void handleCreateShare()}
              disabled={creatingShare}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
            >
              {creatingShare ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Confirm & Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeConfirmOpen} onOpenChange={setRevokeConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<AlertCircle className="size-4.5" />}
            iconClassName="bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400 dark:ring-rose-500/30"
          >
            <DialogTitle>Revoke Share Link</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke this share link? Anyone holding the link will immediately lose access to this report.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end gap-2">
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
                  const resp = await summariesAPI.revokeShare(selectedWeek);
                  if (resp?.revoked) {
                    setShares((prev) => {
                      const copy = { ...prev };
                      delete copy[selectedWeek];
                      return copy;
                    });
                    toast.success("Share link revoked");
                    setRevokeConfirmOpen(false);
                  } else {
                    toast.error("Failed to revoke share link");
                  }
                } catch (e) {
                  console.error(e);
                  toast.error("Failed to revoke share link");
                } finally {
                  setIsRevoking(false);
                }
              }}
              disabled={isRevoking}
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                "Revoke Link"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
