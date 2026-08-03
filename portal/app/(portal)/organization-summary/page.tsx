"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  MessageSquare,
  FileText,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { AxiosError } from "axios";

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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import {
  AvailableWeek,
  OrganizationSummary,
  summariesAPI,
} from "@/lib/api/summaries";

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
      return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200";
    case "medium":
      return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-200";
    case "low":
      return "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200";
  }
}

function getStatusBadgeClasses(status: string) {
  switch (status.toLowerCase()) {
    case "completed":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200";
    case "in_progress":
      return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200";
    case "pending":
    default:
      return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200";
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
      className={`inline-flex items-center gap-1 text-sm font-medium ${
        isZero
          ? "text-muted-foreground"
          : isUp
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400"
      }`}
    >
      {isZero ? (
        <Minus className="h-4 w-4" />
      ) : (
        <TrendIcon className="h-4 w-4" />
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
  const [orgSummary, setOrgSummary] = useState<OrganizationSummary | null>(
    null,
  );

  useEffect(() => {
    const loadAdminContext = async () => {
      try {
        setLoading(true);

        const permsResponse = await apiClient.get("/me/permissions");
        const admin =
          Boolean(permsResponse.data?.is_superuser) ||
          String(permsResponse.data?.role_code ?? "").toUpperCase() === "ADMIN";

        setIsAdmin(admin);
        if (!admin) {
          setError("Admin access required");
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
          setError("Admin access required");
        } else {
          setError("Failed to load organization summary");
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
        setError("Admin access required");
      } else {
        setError("Failed to load organization summary");
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
        title="Access denied"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organization Summary</h1>
          <p className="text-sm text-muted-foreground">
            Admin-only view of weekly organization performance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedWeek ?? ""}
            onValueChange={(value) => setSelectedWeek(value)}
          >
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="Current week" />
            </SelectTrigger>
            <SelectContent>
              {availableWeeks.length === 0 ? (
                <SelectItem value="current">Current week</SelectItem>
              ) : (
                availableWeeks.map((week) => (
                  <SelectItem key={week.week_start_date} value={week.week_start_date}>
                    {format(parseISO(week.week_start_date), "MMM d, yyyy")} -{" "}
                    {format(parseISO(week.week_end_date), "MMM d, yyyy")}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>

          <Button
            onClick={() => void refreshSummary()}
            disabled={!selectedWeek}
          >
            Refresh
          </Button>
        </div>
      </div>

      {error ? (
        <PageErrorCard
          title="Unable to load organization summary"
          message={error}
          onRetry={() => void refreshSummary()}
        />
      ) : null}

      {orgSummary && orgSummary.summaries_count === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No organization summary yet</CardTitle>
            <CardDescription>
              There are no weekly summaries for the selected week, so this view
              is showing a zeroed snapshot.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {orgSummary ? (
        <>
          {/* Top metric cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Week</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="font-semibold">
                  {format(parseISO(orgSummary.week_start_date), "MMM d, yyyy")}{" "}
                  - {format(parseISO(orgSummary.week_end_date), "MMM d, yyyy")}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Summary range for the selected week
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Active Users</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {orgSummary.total_active_users}
                  {renderDelta(orgSummary.comparison?.delta_users)}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Users with weekly summaries
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tasks Completed</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {orgSummary.total_tasks_completed}
                  {renderDelta(orgSummary.comparison?.delta_tasks_completed)}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  of {orgSummary.total_tasks_assigned} assigned
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg Completion Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {orgSummary.avg_completion_rate_percent}%
                  {renderDelta(
                    orgSummary.comparison?.delta_completion_rate,
                    "pct",
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Avg On-Time Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {orgSummary.avg_on_time_completion_rate_percent}%
                  {renderDelta(
                    orgSummary.comparison?.delta_on_time_completion_rate,
                    "pct",
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Summaries Count</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {orgSummary.summaries_count}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Engagement Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Engagement Summary</CardTitle>
              <CardDescription>
                Organization-wide activity for the selected week.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-blue-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Comments Added
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_comments_added ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-green-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Files Attached
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_files_attached ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-blue-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Files Received
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_files_received ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-purple-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Active Recurring Schedules
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_active_recurring_schedules ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-5 w-5 text-orange-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Schedules Created
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_recurring_schedules_created ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-cyan-500" />
                    <span className="text-gray-700 dark:text-slate-300">
                      Daily Reports Created
                    </span>
                  </div>
                  <span className="text-2xl font-bold">
                    {orgSummary.total_daily_reports_created ?? 0}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Task Breakdown: Priority & Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Task Breakdown</CardTitle>
              <CardDescription>
                Organization-wide tasks by priority and status.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h3 className="mb-3 text-sm font-semibold">By Priority</h3>
                  <div className="space-y-2">
                    {orgSummary.priority_distribution &&
                    Object.keys(orgSummary.priority_distribution).length > 0 ? (
                      Object.entries(orgSummary.priority_distribution).map(
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
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No data available.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold">By Status</h3>
                  <div className="space-y-2">
                    {orgSummary.status_distribution &&
                    Object.keys(orgSummary.status_distribution).length > 0 ? (
                      Object.entries(orgSummary.status_distribution).map(
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
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No data available.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Week-over-Week Comparison */}
          {orgSummary.comparison ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Week-over-Week Comparison
                </CardTitle>
                <CardDescription>
                  {orgSummary.comparison.previous_week_start
                    ? `Compared to week of ${format(parseISO(orgSummary.comparison.previous_week_start), "MMM d, yyyy")}`
                    : "Compared to the previous week"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Trend indicator */}
                <div
                  className={`mb-4 rounded-lg p-4 text-sm font-semibold ${
                    orgSummary.comparison.trend === "up"
                      ? "bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300"
                      : orgSummary.comparison.trend === "down"
                        ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                        : "bg-gray-50 text-gray-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {orgSummary.comparison.trend === "up"
                    ? "📈 Organization performance is improving"
                    : orgSummary.comparison.trend === "down"
                      ? "📉 Organization performance is declining"
                      : "➡️ Organization performance is steady"}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ComparisonRow
                    label="Active Users"
                    current={orgSummary.total_active_users}
                    previous={orgSummary.comparison.previous_active_users}
                    delta={orgSummary.comparison.delta_users}
                  />
                  <ComparisonRow
                    label="Tasks Completed"
                    current={orgSummary.total_tasks_completed}
                    previous={orgSummary.comparison.previous_tasks_completed}
                    delta={orgSummary.comparison.delta_tasks_completed}
                  />
                  <ComparisonRow
                    label="Tasks Assigned"
                    current={orgSummary.total_tasks_assigned}
                    delta={orgSummary.comparison.delta_tasks_assigned}
                  />
                  <ComparisonRow
                    label="Completion Rate"
                    current={orgSummary.avg_completion_rate_percent}
                    previous={orgSummary.comparison.previous_completion_rate}
                    delta={orgSummary.comparison.delta_completion_rate}
                    format="pct"
                  />
                  <ComparisonRow
                    label="On-Time Rate"
                    current={orgSummary.avg_on_time_completion_rate_percent}
                    delta={orgSummary.comparison.delta_on_time_completion_rate}
                    format="pct"
                  />
                  <ComparisonRow
                    label="Comments"
                    current={orgSummary.total_comments_added ?? 0}
                    delta={orgSummary.comparison.delta_comments}
                  />
                  <ComparisonRow
                    label="Files Attached"
                    current={orgSummary.total_files_attached ?? 0}
                    delta={orgSummary.comparison.delta_files}
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : loading ? (
        <OrgSummarySkeleton />
      ) : null}
    </div>
  );
}

function ComparisonRow({
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
    <div className="rounded-lg border border-gray-200 p-3 transition-colors hover:border-gray-300 dark:border-slate-700 dark:hover:border-slate-600">
      <p className="text-sm font-medium text-gray-600 dark:text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold text-gray-900 dark:text-slate-100">
          {displayCurrent}
        </span>
        {renderDelta(delta, fmt)}
      </div>
      {displayPrevious != null && (
        <p className="mt-1 text-xs text-muted-foreground">
          Previous: {displayPrevious}
        </p>
      )}
    </div>
  );
}
