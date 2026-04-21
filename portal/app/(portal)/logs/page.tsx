"use client";

import axios from "axios";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LogsTableSkeleton } from "@/components/skeletons/logs-skeleton";
import { apiClient } from "@/lib/api-client";

type PermissionPayload = {
  is_superuser?: boolean;
  role_code?: string | null;
};

type AuditLogEntry = {
  id: number;
  actor_user?: number | null;
  actor_username?: string | null;
  action: string;
  target_type?: string;
  target_id?: string;
  metadata_json?: unknown;
  ip_address?: string | null;
  created_at: string;
  updated_at: string;
};

type LogsResponse = {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next_page: number | null;
  previous_page: number | null;
  results: AuditLogEntry[];
};

const PAGE_SIZE = 30;

type LogFilterMode =
  | "all"
  | "last_1_day"
  | "last_7_days"
  | "last_30_days"
  | "date"
  | "range";

type AppliedFilters = {
  label: string;
  createdFrom?: string;
  createdTo?: string;
};

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function formatMetadata(metadata: unknown) {
  if (metadata === null || metadata === undefined) {
    return "-";
  }

  if (typeof metadata === "string") {
    return metadata;
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return String(metadata);
  }
}

function isAdmin(permission: PermissionPayload | null) {
  if (!permission) {
    return false;
  }

  if (permission.is_superuser) {
    return true;
  }

  return String(permission.role_code ?? "").toUpperCase() === "ADMIN";
}

function getLocalDayBounds(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map((value) => Number(value));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return null;
  }

  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return {
    createdFrom: start.toISOString(),
    createdTo: end.toISOString(),
  };
}

function getRelativeDayRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    createdFrom: start.toISOString(),
    createdTo: end.toISOString(),
  };
}

function getFilterLabel(filters: AppliedFilters) {
  return filters.label === "All time" ? "All logs" : filters.label;
}

function buildFilterStateFromSearchParams(searchParams: URLSearchParams) {
  const mode = searchParams.get("filter") as LogFilterMode | null;
  const createdFrom = searchParams.get("created_from") ?? "";
  const createdTo = searchParams.get("created_to") ?? "";
  const date = searchParams.get("date") ?? "";
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";

  if (mode === "last_1_day") {
    return {
      filterMode: mode,
      selectedDate: "",
      rangeStart: "",
      rangeEnd: "",
      appliedFilters: {
        label: "Last 1 day",
        ...getRelativeDayRange(1),
      },
    };
  }

  if (mode === "last_7_days") {
    return {
      filterMode: mode,
      selectedDate: "",
      rangeStart: "",
      rangeEnd: "",
      appliedFilters: {
        label: "Last 7 days",
        ...getRelativeDayRange(7),
      },
    };
  }

  if (mode === "last_30_days") {
    return {
      filterMode: mode,
      selectedDate: "",
      rangeStart: "",
      rangeEnd: "",
      appliedFilters: {
        label: "Last 30 days",
        ...getRelativeDayRange(30),
      },
    };
  }

  if (mode === "date" && date) {
    const bounds = getLocalDayBounds(date);
    if (bounds) {
      return {
        filterMode: mode,
        selectedDate: date,
        rangeStart: "",
        rangeEnd: "",
        appliedFilters: { label: `Date: ${date}`, ...bounds },
      };
    }
  }

  if (mode === "range" && start && end) {
    const startBounds = getLocalDayBounds(start);
    const endBounds = getLocalDayBounds(end);
    if (startBounds && endBounds) {
      return {
        filterMode: mode,
        selectedDate: "",
        rangeStart: start,
        rangeEnd: end,
        appliedFilters: {
          label: `Range: ${start} to ${end}`,
          createdFrom: startBounds.createdFrom,
          createdTo: endBounds.createdTo,
        },
      };
    }
  }

  if (createdFrom || createdTo) {
    return {
      filterMode: "range" as LogFilterMode,
      selectedDate: "",
      rangeStart: start,
      rangeEnd: end,
      appliedFilters: {
        label: start && end ? `Range: ${start} to ${end}` : "Custom range",
        createdFrom: createdFrom || undefined,
        createdTo: createdTo || undefined,
      },
    };
  }

  return {
    filterMode: "all" as LogFilterMode,
    selectedDate: "",
    rangeStart: "",
    rangeEnd: "",
    appliedFilters: { label: "All time" },
  };
}

export default function LogsPage() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [page, setPage] = useState(1);
  const [logsPayload, setLogsPayload] = useState<LogsResponse | null>(null);
  const [filterMode, setFilterMode] = useState<LogFilterMode>("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [appliedFilters, setAppliedFilters] = useState<AppliedFilters>({
    label: "All time",
  });

  useEffect(() => {
    const search = new URLSearchParams(searchParams.toString());
    const nextPageRaw = search.get("page");
    const nextPage = nextPageRaw ? Number(nextPageRaw) : 1;
    if (Number.isInteger(nextPage) && nextPage > 0 && nextPage !== page) {
      setPage(nextPage);
    }

    const filterState = buildFilterStateFromSearchParams(search);
    setFilterMode(filterState.filterMode);
    setSelectedDate(filterState.selectedDate);
    setRangeStart(filterState.rangeStart);
    setRangeEnd(filterState.rangeEnd);
    setAppliedFilters(filterState.appliedFilters);
    setFilterError(null);
  }, [page, searchParams]);

  function updateSearchParams(
    nextParams: Record<string, string | number | null>,
  ) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(nextParams)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, String(value));
      }
    }

    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }

  useEffect(() => {
    async function loadLogs() {
      try {
        setIsLoading(true);
        setErrorMessage(null);

        const permissionsResponse = await apiClient.get("/me/permissions");
        const permissionData = permissionsResponse.data as PermissionPayload;

        if (!isAdmin(permissionData)) {
          setIsAuthorized(false);
          router.replace("/dashboard");
          return;
        }

        setIsAuthorized(true);

        const params: Record<string, string | number> = { page };
        if (appliedFilters.createdFrom) {
          params.created_from = appliedFilters.createdFrom;
        }
        if (appliedFilters.createdTo) {
          params.created_to = appliedFilters.createdTo;
        }

        const logsResponse = await apiClient.get("/admin/audit-logs", {
          params,
        });

        setLogsPayload(logsResponse.data as LogsResponse);
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          setIsAuthorized(false);
          router.replace("/dashboard");
          return;
        }

        const fallback = "Failed to load logs.";
        const detail = axios.isAxiosError(error)
          ? (error.response?.data?.detail as string | undefined)
          : undefined;
        setErrorMessage(detail || fallback);
      } finally {
        setIsLoading(false);
      }
    }

    void loadLogs();
  }, [appliedFilters, page, router]);

  function applyFilters() {
    setFilterError(null);

    if (filterMode === "all") {
      setAppliedFilters({ label: "All time" });
      updateSearchParams({
        filter: null,
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (filterMode === "last_1_day") {
      setAppliedFilters({ label: "Last 1 day", ...getRelativeDayRange(1) });
      updateSearchParams({
        filter: "last_1_day",
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (filterMode === "last_7_days") {
      setAppliedFilters({ label: "Last 7 days", ...getRelativeDayRange(7) });
      updateSearchParams({
        filter: "last_7_days",
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (filterMode === "last_30_days") {
      setAppliedFilters({ label: "Last 30 days", ...getRelativeDayRange(30) });
      updateSearchParams({
        filter: "last_30_days",
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (filterMode === "date") {
      if (!selectedDate) {
        setFilterError("Choose a date to filter the logs.");
        return;
      }

      const bounds = getLocalDayBounds(selectedDate);
      if (!bounds) {
        setFilterError("Choose a valid date.");
        return;
      }

      setAppliedFilters({ label: `Date: ${selectedDate}`, ...bounds });
      updateSearchParams({
        filter: "date",
        date: selectedDate,
        created_from: null,
        created_to: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (!rangeStart || !rangeEnd) {
      setFilterError("Choose both start and end dates for the range.");
      return;
    }

    if (rangeStart > rangeEnd) {
      setFilterError("The start date must be before or equal to the end date.");
      return;
    }

    const startBounds = getLocalDayBounds(rangeStart);
    const endBounds = getLocalDayBounds(rangeEnd);
    if (!startBounds || !endBounds) {
      setFilterError("Choose a valid date range.");
      return;
    }

    setAppliedFilters({
      label: `Range: ${rangeStart} to ${rangeEnd}`,
      createdFrom: startBounds.createdFrom,
      createdTo: endBounds.createdTo,
    });
    updateSearchParams({
      filter: "range",
      start: rangeStart,
      end: rangeEnd,
      created_from: null,
      created_to: null,
      date: null,
      page: 1,
    });
    setPage(1);
  }

  function applyPresetFilter(mode: Exclude<LogFilterMode, "date" | "range">) {
    setFilterError(null);
    setFilterMode(mode);

    if (mode === "all") {
      setSelectedDate("");
      setRangeStart("");
      setRangeEnd("");
      setAppliedFilters({ label: "All time" });
      updateSearchParams({
        filter: null,
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (mode === "last_1_day") {
      setSelectedDate("");
      setRangeStart("");
      setRangeEnd("");
      setAppliedFilters({ label: "Last 1 day", ...getRelativeDayRange(1) });
      updateSearchParams({
        filter: "last_1_day",
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    if (mode === "last_7_days") {
      setSelectedDate("");
      setRangeStart("");
      setRangeEnd("");
      setAppliedFilters({ label: "Last 7 days", ...getRelativeDayRange(7) });
      updateSearchParams({
        filter: "last_7_days",
        created_from: null,
        created_to: null,
        date: null,
        start: null,
        end: null,
        page: 1,
      });
      setPage(1);
      return;
    }

    setSelectedDate("");
    setRangeStart("");
    setRangeEnd("");
    setAppliedFilters({ label: "Last 30 days", ...getRelativeDayRange(30) });
    updateSearchParams({
      filter: "last_30_days",
      created_from: null,
      created_to: null,
      date: null,
      start: null,
      end: null,
      page: 1,
    });
    setPage(1);
  }

  function clearFilters() {
    setFilterError(null);
    setFilterMode("all");
    setSelectedDate("");
    setRangeStart("");
    setRangeEnd("");
    setAppliedFilters({ label: "All time" });
    updateSearchParams({
      filter: null,
      created_from: null,
      created_to: null,
      date: null,
      start: null,
      end: null,
      page: 1,
    });
    setPage(1);
  }

  const logs = logsPayload?.results ?? [];
  const totalCount = logsPayload?.count ?? 0;
  const totalPages = logsPayload?.total_pages ?? 1;
  const hasNext = Boolean(logsPayload?.next_page);
  const hasPrevious = Boolean(logsPayload?.previous_page);

  const rangeLabel = useMemo(() => {
    if (totalCount === 0) {
      return `${getFilterLabel(appliedFilters)} · No logs available`;
    }

    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalCount);
    return `Showing ${start}-${end} of ${totalCount} · ${getFilterLabel(appliedFilters)}`;
  }, [appliedFilters, page, totalCount]);

  function changePage(nextPage: number) {
    setPage(nextPage);
    updateSearchParams({ page: nextPage });
  }

  if (isLoading || isAuthorized === null) {
    return <LogsTableSkeleton />;
  }

  if (!isAuthorized) {
    return null;
  }

  if (errorMessage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="w-full max-w-2xl border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" aria-hidden="true" />
              Failed to load logs
            </CardTitle>
            <CardDescription>{errorMessage}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.refresh()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Audit Logs</CardTitle>
          <CardDescription>
            {rangeLabel}. Ordered by newest events first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4 rounded-lg border border-border bg-muted/20 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <div className="space-y-2">
              <Label>Filter period</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={filterMode === "all" ? "default" : "outline"}
                  onClick={() => applyPresetFilter("all")}
                >
                  All logs
                </Button>
                <Button
                  type="button"
                  variant={filterMode === "last_1_day" ? "default" : "outline"}
                  onClick={() => applyPresetFilter("last_1_day")}
                >
                  Last 1 day
                </Button>
                <Button
                  type="button"
                  variant={filterMode === "last_7_days" ? "default" : "outline"}
                  onClick={() => applyPresetFilter("last_7_days")}
                >
                  Last 7 days
                </Button>
                <Button
                  type="button"
                  variant={
                    filterMode === "last_30_days" ? "default" : "outline"
                  }
                  onClick={() => applyPresetFilter("last_30_days")}
                >
                  Last 30 days
                </Button>
                <Button
                  type="button"
                  variant={filterMode === "date" ? "default" : "outline"}
                  onClick={() => {
                    setFilterError(null);
                    setFilterMode("date");
                  }}
                >
                  Select Date
                </Button>
                <Button
                  type="button"
                  variant={filterMode === "range" ? "default" : "outline"}
                  onClick={() => {
                    setFilterError(null);
                    setFilterMode("range");
                  }}
                >
                  Select Date range
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {filterMode === "date" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="log-filter-date">Date</Label>
                    <Input
                      id="log-filter-date"
                      type="date"
                      value={selectedDate}
                      onChange={(event) => setSelectedDate(event.target.value)}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button type="submit" className="w-24">
                      Apply
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearFilters}
                      disabled={appliedFilters.label === "All time"}
                      className="w-24"
                    >
                      Clear
                    </Button>
                  </div>
                </>
              ) : null}

              {filterMode === "range" ? (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="log-filter-start">Start date</Label>
                    <Input
                      id="log-filter-start"
                      type="date"
                      value={rangeStart}
                      onChange={(event) => setRangeStart(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="log-filter-end">End date</Label>
                    <Input
                      id="log-filter-end"
                      type="date"
                      value={rangeEnd}
                      onChange={(event) => setRangeEnd(event.target.value)}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button type="submit" className="w-24">
                      Apply
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={clearFilters}
                      disabled={appliedFilters.label === "All time"}
                      className="w-24"
                    >
                      Clear
                    </Button>
                  </div>
                </>
              ) : null}
            </div>

            {filterError ? (
              <p className="text-sm text-destructive">{filterError}</p>
            ) : null}
          </form>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">ID</th>
                  <th className="px-3 py-2 font-semibold">Timestamp</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                  <th className="px-3 py-2 font-semibold">IP Address</th>
                  <th className="px-3 py-2 font-semibold">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-background">
                {logs.length === 0 ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      No audit logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="align-top">
                      <td className="px-3 py-3 font-medium text-foreground">
                        {log.id}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDate(log.created_at)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {log.actor_username || "system"}
                      </td>
                      <td className="px-3 py-3 text-foreground">
                        {log.action}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {log.target_type || "-"}
                        {log.target_id ? ` (${log.target_id})` : ""}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {log.ip_address || "-"}
                      </td>
                      <td className="max-w-[380px] px-3 py-3 text-muted-foreground">
                        <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/40 px-2 py-1 text-xs">
                          {formatMetadata(log.metadata_json)}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => changePage(Math.max(1, page - 1))}
                disabled={!hasPrevious}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                onClick={() => changePage(page + 1)}
                disabled={!hasNext}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
