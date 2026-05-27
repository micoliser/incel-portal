"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2 } from "lucide-react";

import { PageErrorCard } from "@/components/page-error-card";
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
      } catch (err: any) {
        if (err?.response?.status === 403) {
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
    } catch (err: any) {
      if (err?.response?.status === 403) {
        setError("Admin access required");
      } else {
        setError("Failed to load organization summary");
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading && isAdmin === null) {
    return (
      <div className="p-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
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
          <select
            value={selectedWeek ?? ""}
            onChange={(e) => setSelectedWeek(e.target.value)}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {availableWeeks.length === 0 ? (
              <option value="">Current week</option>
            ) : (
              availableWeeks.map((week) => (
                <option key={week.week_start_date} value={week.week_start_date}>
                  {format(parseISO(week.week_start_date), "MMM d, yyyy")} -{" "}
                  {format(parseISO(week.week_end_date), "MMM d, yyyy")}
                </option>
              ))
            )}
          </select>

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Week</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-semibold">
                {format(parseISO(orgSummary.week_start_date), "MMM d, yyyy")} -{" "}
                {format(parseISO(orgSummary.week_end_date), "MMM d, yyyy")}
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
      ) : loading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading organization summary...
        </div>
      ) : null}
    </div>
  );
}
