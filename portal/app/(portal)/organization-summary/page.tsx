"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  BarChart3,
  Calendar,
  CheckSquare2,
  Clock,
  FileCheck,
  FileDown,
  FileText,
  FileUp,
  MessageSquare,
  Minus,
  RefreshCw,
  Repeat,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import type { AxiosError } from "axios";
import { extractApiErrorMessage } from "@/lib/api-errors";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageErrorCard } from "@/components/page-error-card";
import { OrgSummarySkeleton } from "@/components/skeletons/org-summary-skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import {
  AvailableWeek,
  OrganizationSummary,
  summariesAPI,
} from "@/lib/api/summaries";
import { cn } from "@/lib/utils";

function getCurrentWeekStartDate() {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  return format(monday, "yyyy-MM-dd");
}

function getPriorityBadgeClasses(priority: string) {
  switch (priority.toLowerCase()) {
    case "high":
      return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400";
    case "medium":
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "low":
    default:
      return "border-border/70 bg-muted/60 text-muted-foreground";
  }
}

function getStatusBadgeClasses(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "in_progress":
      return "border-[#0d47a1]/25 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]";
    case "pending":
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
}

function fmtDelta(value: number, fmt: "count" | "pct" = "count") {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return fmt === "pct" ? `${sign}${value.toFixed(1)}%` : `${sign}${value}`;
}

function renderDelta(
  value: number | undefined | null,
  fmt: "count" | "pct" = "count",
) {
  if (value == null || !Number.isFinite(value)) return null;
  const isUp = value > 0;
  const isZero = value === 0;
  const TrendIcon = isUp ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums border",
        isZero
          ? "border-border/70 bg-muted/50 text-muted-foreground"
          : isUp
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            : "border-[#dc2626]/25 bg-[#dc2626]/10 text-[#dc2626] dark:text-red-400",
      )}
    >
      {isZero ? (
        <Minus className="size-3" />
      ) : (
        <TrendIcon className="size-3" />
      )}
      {fmtDelta(value, fmt)}
    </span>
  );
}

export default function OrganizationSummaryPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgSummary, setOrgSummary] = useState<OrganizationSummary | null>(null);

  useEffect(() => {
    const loadAdminContext = async () => {
      try {
        setLoading(true);

        const permsResponse = await apiClient.get("/me/permissions");
        const hasGlobalAccess = Boolean(permsResponse.data?.has_global_access);
        const admin =
          Boolean(permsResponse.data?.is_superuser) ||
          String(permsResponse.data?.role_code ?? "").toUpperCase() === "ADMIN";

        const authorized = admin || hasGlobalAccess;
        setIsAdmin(authorized);
        if (!authorized) {
          setError("Admin or Global access required");
          return;
        }

        const weeks = await summariesAPI.getAvailableWeeks();
        setAvailableWeeks(weeks || []);
        setSelectedWeek(
          weeks?.[0]?.week_start_date ?? getCurrentWeekStartDate(),
        );
      } catch {
        setError("Failed to load admin context");
      } finally {
        setLoading(false);
      }
    };

    void loadAdminContext();
  }, []);

  useEffect(() => {
    if (!selectedWeek || isAdmin !== true) {
      return;
    }

    const loadSummary = async () => {
      try {
        setLoading(true);
        const data = await summariesAPI.getOrganizationSummary(selectedWeek);
        setOrgSummary(data);
        setError(null);
      } catch (err) {
        const error = err as AxiosError<{ detail?: string }>;
        if (error.response?.status === 403) {
          setError(extractApiErrorMessage(err, "Admin access required"));
        } else {
          setError(
            extractApiErrorMessage(err, "Failed to load organization summary"),
          );
        }
        setOrgSummary(null);
      } finally {
        setLoading(false);
      }
    };

    void loadSummary();
  }, [selectedWeek, isAdmin]);

  const refreshSummary = async () => {
    if (!selectedWeek) {
      return;
    }

    try {
      setLoading(true);
      const data = await summariesAPI.getOrganizationSummary(selectedWeek);
      setOrgSummary(data);
      setError(null);
    } catch (err) {
      const error = err as AxiosError<{ detail?: string }>;
      if (error.response?.status === 403) {
        setError(extractApiErrorMessage(err, "Admin access required"));
      } else {
        setError(
          extractApiErrorMessage(err, "Failed to load organization summary"),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && isAdmin === null) {
    return <OrgSummarySkeleton />;
  }

  if (error && isAdmin === false) {
    return (
      <PageErrorCard
        title="Access Denied"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  // Priority total for percentage calculation
  const totalPriorityCount = orgSummary?.priority_distribution
    ? Object.values(orgSummary.priority_distribution).reduce((a, b) => a + b, 0)
    : 0;

  // Status total for percentage calculation
  const totalStatusCount = orgSummary?.status_distribution
    ? Object.values(orgSummary.status_distribution).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      {/* Top Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                <BarChart3 className="size-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Organization Summary
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Executive overview of weekly company performance, task deliveries, and activity benchmarks.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Select
              value={selectedWeek ?? ""}
              onValueChange={(value) => setSelectedWeek(value)}
            >
              <SelectTrigger className="w-[230px] h-10 rounded-xl border-border/80 bg-card text-xs font-medium">
                <Calendar className="size-3.5 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Current week" />
              </SelectTrigger>
              <SelectContent>
                {availableWeeks.length === 0 ? (
                  <SelectItem value="current">Current week</SelectItem>
                ) : (
                  availableWeeks.map((week) => (
                    <SelectItem
                      key={week.week_start_date}
                      value={week.week_start_date}
                    >
                      {format(parseISO(week.week_start_date), "MMM d, yyyy")} –{" "}
                      {format(parseISO(week.week_end_date), "MMM d, yyyy")}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshSummary()}
              disabled={!selectedWeek || loading}
              className="h-10 gap-1.5 rounded-xl border-border/80 text-xs font-medium hover:bg-muted"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <PageErrorCard
          title="Unable to Load Organization Summary"
          message={error}
          onRetry={() => void refreshSummary()}
        />
      ) : null}

      {orgSummary && orgSummary.summaries_count === 0 ? (
        <Card className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border-dashed border-border/90 p-8 text-center shadow-xs">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] mb-4">
            <BarChart3 className="size-7" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            No Summaries Submitted
          </h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            There are no weekly summaries logged for the selected period. Metrics will populate once employees submit weekly updates.
          </p>
        </Card>
      ) : null}

      {orgSummary ? (
        <>
          {/* Key Metric Overview Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Active Users */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-[#0d47a1]/30 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Active Users
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                  <Users className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {orgSummary.total_active_users}
                  </span>
                  {renderDelta(orgSummary.comparison?.delta_users)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Personnel with active weekly summaries
                </p>
              </div>
            </Card>

            {/* Tasks Completed */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-emerald-500/30 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tasks Completed
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckSquare2 className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {orgSummary.total_tasks_completed}
                  </span>
                  {renderDelta(orgSummary.comparison?.delta_tasks_completed)}
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  of {orgSummary.total_tasks_assigned} total assigned tasks
                </p>
              </div>
            </Card>

            {/* Avg Completion Rate */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-blue-500/30 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Avg Completion Rate
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  <Target className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {orgSummary.avg_completion_rate_percent}%
                  </span>
                  {renderDelta(
                    orgSummary.comparison?.delta_completion_rate,
                    "pct",
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Overall enterprise assignment delivery rate
                </p>
              </div>
            </Card>

            {/* Avg On-Time Rate */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-amber-500/30 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Avg On-Time Rate
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Clock className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {orgSummary.avg_on_time_completion_rate_percent}%
                  </span>
                  {renderDelta(
                    orgSummary.comparison?.delta_on_time_completion_rate,
                    "pct",
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Work completed on or prior to schedule
                </p>
              </div>
            </Card>

            {/* Summaries Count */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-purple-500/30 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Summaries Received
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                  <FileText className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">
                    {orgSummary.summaries_count}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Submitted reports logged this cycle
                </p>
              </div>
            </Card>

            {/* Cycle Period */}
            <Card className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all hover:border-border hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cycle Window
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Calendar className="size-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-base font-semibold text-foreground">
                  {format(parseISO(orgSummary.week_start_date), "MMM d, yyyy")} –{" "}
                  {format(parseISO(orgSummary.week_end_date), "MMM d, yyyy")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Official reporting window for this summary
                </p>
              </div>
            </Card>
          </div>

          {/* Engagement Activity Breakdown */}
          <div className="space-y-3">
            <h2 className="text-base font-bold text-foreground">
              Engagement & Activity
            </h2>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-[#0d47a1]/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] mb-2.5">
                  <MessageSquare className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_comments_added ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Comments Logged
                </p>
              </Card>

              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-emerald-500/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-2.5">
                  <FileUp className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_files_attached ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Files Attached
                </p>
              </Card>

              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-blue-500/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 mb-2.5">
                  <FileDown className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_files_received ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Files Received
                </p>
              </Card>

              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-purple-500/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 mb-2.5">
                  <Repeat className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_active_recurring_schedules ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Active Schedules
                </p>
              </Card>

              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-amber-500/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-2.5">
                  <Clock className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_recurring_schedules_created ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Schedules Created
                </p>
              </Card>

              <Card className="rounded-xl border border-border/70 bg-card p-4 shadow-2xs hover:border-cyan-500/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 mb-2.5">
                  <FileCheck className="size-4" />
                </div>
                <p className="text-2xl font-bold tabular-nums text-foreground">
                  {orgSummary.total_daily_reports_created ?? 0}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Daily Reports
                </p>
              </Card>
            </div>
          </div>

          {/* Task Breakdown: Priority & Status Distribution */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* By Priority */}
            <Card className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-rose-500" />
                  <h3 className="text-sm font-bold text-foreground">
                    Tasks by Priority
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {totalPriorityCount} total tasks
                </span>
              </div>

              {orgSummary.priority_distribution &&
              Object.keys(orgSummary.priority_distribution).length > 0 ? (
                <div className="space-y-3.5">
                  {/* Proportion bar */}
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                    {Object.entries(orgSummary.priority_distribution).map(
                      ([priority, count]) => {
                        const pct = totalPriorityCount > 0 ? (count / totalPriorityCount) * 100 : 0;
                        const barColor =
                          priority.toLowerCase() === "high"
                            ? "bg-rose-500"
                            : priority.toLowerCase() === "medium"
                              ? "bg-amber-500"
                              : "bg-slate-400";
                        return (
                          <div
                            key={priority}
                            style={{ width: `${pct}%` }}
                            className={cn("h-full transition-all", barColor)}
                            title={`${priority}: ${count} (${pct.toFixed(0)}%)`}
                          />
                        );
                      },
                    )}
                  </div>

                  {/* List items */}
                  <div className="space-y-2 pt-1">
                    {Object.entries(orgSummary.priority_distribution).map(
                      ([priority, count]) => {
                        const pct =
                          totalPriorityCount > 0
                            ? ((count / totalPriorityCount) * 100).toFixed(0)
                            : 0;
                        return (
                          <div
                            key={priority}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                          >
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
                                getPriorityBadgeClasses(priority),
                              )}
                            >
                              {priority}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground tabular-nums">
                                {pct}%
                              </span>
                              <span className="font-bold text-foreground tabular-nums">
                                {count}
                              </span>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No priority data recorded for this week.
                </p>
              )}
            </Card>

            {/* By Status */}
            <Card className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-border/60 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <div className="size-2 rounded-full bg-emerald-500" />
                  <h3 className="text-sm font-bold text-foreground">
                    Tasks by Status
                  </h3>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {totalStatusCount} total tasks
                </span>
              </div>

              {orgSummary.status_distribution &&
              Object.keys(orgSummary.status_distribution).length > 0 ? (
                <div className="space-y-3.5">
                  {/* Proportion bar */}
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                    {Object.entries(orgSummary.status_distribution).map(
                      ([status, count]) => {
                        const pct = totalStatusCount > 0 ? (count / totalStatusCount) * 100 : 0;
                        const barColor =
                          status.toLowerCase() === "completed"
                            ? "bg-emerald-500"
                            : status.toLowerCase() === "in_progress"
                              ? "bg-[#0d47a1]"
                              : "bg-amber-500";
                        return (
                          <div
                            key={status}
                            style={{ width: `${pct}%` }}
                            className={cn("h-full transition-all", barColor)}
                            title={`${status}: ${count} (${pct.toFixed(0)}%)`}
                          />
                        );
                      },
                    )}
                  </div>

                  {/* List items */}
                  <div className="space-y-2 pt-1">
                    {Object.entries(orgSummary.status_distribution).map(
                      ([status, count]) => {
                        const pct =
                          totalStatusCount > 0
                            ? ((count / totalStatusCount) * 100).toFixed(0)
                            : 0;
                        const label =
                          status === "in_progress"
                            ? "In Progress"
                            : status === "completed"
                              ? "Completed"
                              : "Pending";
                        return (
                          <div
                            key={status}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs"
                          >
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
                                getStatusBadgeClasses(status),
                              )}
                            >
                              {label}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground tabular-nums">
                                {pct}%
                              </span>
                              <span className="font-bold text-foreground tabular-nums">
                                {count}
                              </span>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No status data recorded for this week.
                </p>
              )}
            </Card>
          </div>

          {/* Week-over-Week Comparison */}
          {orgSummary.comparison ? (
            <Card className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4 mb-5">
                <div>
                  <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                    <TrendingUp className="size-4.5 text-[#0d47a1] dark:text-[#38bdf8]" />
                    Week-over-Week Comparison
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {orgSummary.comparison.previous_week_start
                      ? `Compared to reporting cycle of ${format(parseISO(orgSummary.comparison.previous_week_start), "MMM d, yyyy")}`
                      : "Compared against prior reporting period"}
                  </p>
                </div>

                {/* Trend Banner Pill */}
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold self-start sm:self-auto",
                    orgSummary.comparison.trend === "up"
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : orgSummary.comparison.trend === "down"
                        ? "border-[#dc2626]/25 bg-[#dc2626]/10 text-[#dc2626] dark:text-red-400"
                        : "border-border/70 bg-muted/60 text-muted-foreground",
                  )}
                >
                  {orgSummary.comparison.trend === "up" ? (
                    <>
                      <TrendingUp className="size-3.5" />
                      <span>Performance Trending Up</span>
                    </>
                  ) : orgSummary.comparison.trend === "down" ? (
                    <>
                      <TrendingDown className="size-3.5" />
                      <span>Performance Trending Down</span>
                    </>
                  ) : (
                    <>
                      <Minus className="size-3.5" />
                      <span>Performance Steady</span>
                    </>
                  )}
                </div>
              </div>

              {/* Metric Comparison Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ComparisonMetricCard
                  label="Active Personnel"
                  current={orgSummary.total_active_users}
                  previous={orgSummary.comparison.previous_active_users}
                  delta={orgSummary.comparison.delta_users}
                />
                <ComparisonMetricCard
                  label="Tasks Completed"
                  current={orgSummary.total_tasks_completed}
                  previous={orgSummary.comparison.previous_tasks_completed}
                  delta={orgSummary.comparison.delta_tasks_completed}
                />
                <ComparisonMetricCard
                  label="Tasks Assigned"
                  current={orgSummary.total_tasks_assigned}
                  delta={orgSummary.comparison.delta_tasks_assigned}
                />
                <ComparisonMetricCard
                  label="Completion Rate"
                  current={orgSummary.avg_completion_rate_percent}
                  previous={orgSummary.comparison.previous_completion_rate}
                  delta={orgSummary.comparison.delta_completion_rate}
                  format="pct"
                />
                <ComparisonMetricCard
                  label="On-Time Delivery"
                  current={orgSummary.avg_on_time_completion_rate_percent}
                  delta={orgSummary.comparison.delta_on_time_completion_rate}
                  format="pct"
                />
                <ComparisonMetricCard
                  label="Comments Logged"
                  current={orgSummary.total_comments_added ?? 0}
                  delta={orgSummary.comparison.delta_comments}
                />
                <ComparisonMetricCard
                  label="Files Exchanged"
                  current={
                    (orgSummary.total_files_attached ?? 0) +
                    (orgSummary.total_files_received ?? 0)
                  }
                  delta={orgSummary.comparison.delta_files}
                />
              </div>
            </Card>
          ) : null}
        </>
      ) : loading ? (
        <OrgSummarySkeleton />
      ) : null}
    </div>
  );
}

function ComparisonMetricCard({
  label,
  current,
  previous,
  delta,
  format: fmt = "count",
}: {
  label: string;
  current: number;
  previous?: number;
  delta: number | undefined | null;
  format?: "count" | "pct";
}) {
  const displayCurrent = fmt === "pct" ? `${current}%` : String(current);
  const displayPrevious =
    previous != null
      ? fmt === "pct"
        ? `${previous}%`
        : String(previous)
      : null;

  return (
    <div className="rounded-xl border border-border/70 bg-card p-3.5 shadow-2xs transition-all hover:border-border">
      <p className="text-xs font-medium text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-xl font-bold tracking-tight text-foreground tabular-nums">
          {displayCurrent}
        </span>
        {renderDelta(delta, fmt)}
      </div>
      {displayPrevious != null && (
        <p className="mt-1 text-[11px] text-muted-foreground/80 tabular-nums">
          Prior: {displayPrevious}
        </p>
      )}
    </div>
  );
}
