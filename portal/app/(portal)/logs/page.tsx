"use client";
import { extractApiErrorMessage } from "@/lib/api-errors";

import axios from "axios";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Calendar,
  Clock,
  Activity,
  Search,
  Globe,
  RotateCcw,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { LogsTableSkeleton } from "@/components/skeletons/logs-skeleton";
import { PageErrorCard } from "@/components/page-error-card";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type PermissionPayload = {
  is_superuser?: boolean;
  role_code?: string | null;
  has_global_access?: boolean;
};

type AuditLogEntry = {
  id: string;
  actor_user?: number | null;
  actor_username?: string | null;
  action: string;
  action_label?: string;
  target_type?: string;
  target_id?: string;
  target_label?: string;
  message?: string;
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

function formatDateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: value, time: "" };
  }
  const date = parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return { date, time };
}

function getActorInitials(actor?: string | null) {
  if (!actor || actor.toLowerCase() === "system") {
    return "SY";
  }
  const parts = actor.split(/[._@ -]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return actor.slice(0, 2).toUpperCase();
}

function getActionBadge(action: string) {
  const act = action.toLowerCase();
  if (act.includes("login") || act.includes("auth")) {
    return {
      label: "AUTH",
      badge: "bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80]",
      dot: "bg-[#16a34a] dark:bg-[#4ade80]",
    };
  }
  if (act.includes("create") || act.includes("add")) {
    return {
      label: "CREATE",
      badge: "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]",
      dot: "bg-[#0d47a1] dark:bg-[#38bdf8]",
    };
  }
  if (act.includes("update") || act.includes("edit") || act.includes("patch")) {
    return {
      label: "UPDATE",
      badge: "bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
      dot: "bg-sky-500 dark:bg-sky-400",
    };
  }
  if (act.includes("delete") || act.includes("remove") || act.includes("revoke")) {
    return {
      label: "DELETE",
      badge: "bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/20 dark:text-red-400",
      dot: "bg-[#dc2626] dark:bg-red-400",
    };
  }
  return {
    label: "SYSTEM",
    badge: "bg-muted text-muted-foreground dark:bg-muted/40",
    dot: "bg-muted-foreground",
  };
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

function shortId(value: string) {
  if (!value) {
    return "-";
  }
  return value.slice(0, 8);
}

function isAdmin(permission: PermissionPayload | null) {
  if (!permission) {
    return false;
  }

  if (permission.is_superuser || permission.has_global_access) {
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
  const [searchQuery, setSearchQuery] = useState("");

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

        const message = extractApiErrorMessage(error, "Failed to load logs.");
        toast.error(message);
        setErrorMessage(message);
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

  const logs = useMemo(() => logsPayload?.results ?? [], [logsPayload?.results]);
  const totalCount = logsPayload?.count ?? 0;
  const totalPages = logsPayload?.total_pages ?? 1;
  const hasNext = Boolean(logsPayload?.next_page);
  const hasPrevious = Boolean(logsPayload?.previous_page);

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase().trim();
    return logs.filter((log) => {
      return (
        (log.actor_username && log.actor_username.toLowerCase().includes(q)) ||
        (log.message && log.message.toLowerCase().includes(q)) ||
        (log.action && log.action.toLowerCase().includes(q)) ||
        (log.action_label && log.action_label.toLowerCase().includes(q)) ||
        (log.ip_address && log.ip_address.toLowerCase().includes(q)) ||
        (log.target_label && log.target_label.toLowerCase().includes(q)) ||
        (log.target_type && log.target_type.toLowerCase().includes(q))
      );
    });
  }, [logs, searchQuery]);

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
      <PageErrorCard
        title="Failed to load logs"
        message={errorMessage}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* 1. Header & Live Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Audit & Activity Logs
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Immutable workspace audit trail tracking authentication, data mutations, and security events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80] border border-[#16a34a]/20">
            <span className="size-1.5 rounded-full bg-[#16a34a] animate-pulse" />
            Audit Logging Active
          </span>
        </div>
      </div>

      {/* 2. Key Audit Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Total Events */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Logged Events
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <ShieldCheck className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {totalCount.toLocaleString()}
            </span>
            <span className="text-xs text-muted-foreground">in scope</span>
          </div>
        </Card>

        {/* Timeframe Scope */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Timeframe Scope
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <Calendar className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate"
              title={getFilterLabel(appliedFilters)}
            >
              {getFilterLabel(appliedFilters)}
            </span>
          </div>
        </Card>

        {/* Current Page View */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Current Page
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <Activity className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {page}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {totalPages}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              ({logs.length} on page)
            </span>
          </div>
        </Card>

        {/* Latest Activity */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Latest Activity
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-base sm:text-lg font-bold tracking-tight text-foreground truncate">
              {logs[0] ? formatDateTime(logs[0].created_at).time : "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              {logs[0] ? formatDateTime(logs[0].created_at).date : ""}
            </span>
          </div>
        </Card>
      </div>

      {/* 3. Filter Controls & Search */}
      <Card className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => applyPresetFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "all"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              All Logs
            </button>
            <button
              type="button"
              onClick={() => applyPresetFilter("last_1_day")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_1_day"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Last 24 Hours
            </button>
            <button
              type="button"
              onClick={() => applyPresetFilter("last_7_days")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_7_days"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => applyPresetFilter("last_30_days")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_30_days"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterError(null);
                setFilterMode("date");
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "date"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Specific Date
            </button>
            <button
              type="button"
              onClick={() => {
                setFilterError(null);
                setFilterMode("range");
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "range"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              Date Range
            </button>
          </div>

          {/* Quick Page Search */}
          <div className="relative min-w-[240px] lg:max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actor, event, IP, code..."
              className="h-9 pl-9 pr-8 rounded-lg bg-background/50 border-input text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Date Inputs if Date or Range is selected */}
        {(filterMode === "date" || filterMode === "range") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyFilters();
            }}
            className="flex flex-wrap items-end gap-3 pt-3 border-t border-border/50"
          >
            {filterMode === "date" ? (
              <div className="space-y-1">
                <Label
                  htmlFor="log-filter-date"
                  className="text-xs text-muted-foreground"
                >
                  Select Date
                </Label>
                <Input
                  id="log-filter-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-9 text-xs rounded-lg bg-background/50 border-input w-44"
                />
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label
                    htmlFor="log-filter-start"
                    className="text-xs text-muted-foreground"
                  >
                    Start Date
                  </Label>
                  <Input
                    id="log-filter-start"
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="h-9 text-xs rounded-lg bg-background/50 border-input w-44"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="log-filter-end"
                    className="text-xs text-muted-foreground"
                  >
                    End Date
                  </Label>
                  <Input
                    id="log-filter-end"
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="h-9 text-xs rounded-lg bg-background/50 border-input w-44"
                  />
                </div>
              </>
            )}

            <Button
              type="submit"
              size="sm"
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white h-9 px-4 rounded-lg text-xs font-semibold"
            >
              Apply Filter
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearFilters}
              disabled={appliedFilters.label === "All time"}
              className="h-9 px-3 rounded-lg text-xs"
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              Reset
            </Button>
            {filterError && (
              <p className="text-xs text-destructive self-center">
                {filterError}
              </p>
            )}
          </form>
        )}
      </Card>

      {/* 4. Logs Data Table */}
      <Card className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Event / Action</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    <ShieldCheck className="size-8 mx-auto mb-2 opacity-40" />
                    <p className="font-medium text-foreground">
                      No audit logs found
                    </p>
                    <p className="text-xs mt-1">
                      Try adjusting the filter period or search query.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const dt = formatDateTime(log.created_at);
                  const badgeCfg = getActionBadge(log.action);
                  const initials = getActorInitials(log.actor_username);

                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-muted/30 transition-colors group align-top"
                    >
                      {/* Timestamp */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-foreground">
                            {dt.date}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground mt-0.5">
                            {dt.time}
                          </span>
                        </div>
                      </td>

                      {/* Actor */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold border border-primary/20">
                            {initials}
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="text-xs font-semibold text-foreground truncate max-w-[200px]">
                              {log.actor_username || "system"}
                            </span>
                            {log.actor_user && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                ID #{log.actor_user}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Event / Action */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-1 max-w-lg">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                                badgeCfg.badge
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  badgeCfg.dot
                                )}
                              />
                              {badgeCfg.label}
                            </span>
                            {log.target_type && (
                              <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/50">
                                {log.target_type}
                                {log.target_id ? ` #${log.target_id}` : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-semibold text-foreground leading-snug">
                            {log.message || log.action_label || log.action}
                          </p>
                          {log.action_label &&
                            log.action_label !== log.message && (
                              <p className="text-[11px] text-muted-foreground font-mono">
                                {log.action}
                              </p>
                            )}
                        </div>
                      </td>

                      {/* IP Address */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {log.ip_address ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs px-2 py-0.5 rounded bg-muted/60 text-foreground border border-border/40">
                            <Globe className="size-3 text-muted-foreground" />
                            {log.ip_address}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">
                            —
                          </span>
                        )}
                      </td>

                      {/* Details */}
                      <td className="px-4 py-3.5 max-w-[300px]">
                        <details className="group/details rounded-lg border border-border bg-muted/20 px-2.5 py-1.5 text-xs">
                          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground font-medium flex items-center justify-between text-[11px]">
                            <span>View Metadata</span>
                            <ChevronDown className="size-3 transition-transform group-open/details:rotate-180" />
                          </summary>
                          <div className="mt-2.5 pt-2 border-t border-border/50 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between font-mono text-muted-foreground">
                              <span>Log ID:</span>
                              <span className="text-foreground" title={log.id}>
                                {shortId(log.id)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between font-mono text-muted-foreground">
                              <span>Action:</span>
                              <span className="text-foreground">
                                {log.action}
                              </span>
                            </div>
                            {log.target_label && (
                              <div className="flex items-center justify-between font-mono text-muted-foreground">
                                <span>Target:</span>
                                <span className="text-foreground truncate max-w-[160px]">
                                  {log.target_label}
                                </span>
                              </div>
                            )}
                            <div className="mt-1.5">
                              <span className="font-mono text-muted-foreground block mb-1">
                                Payload:
                              </span>
                              <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded border border-border bg-background/80 p-1.5 font-mono text-[10px] text-foreground">
                                {formatMetadata(log.metadata_json)}
                              </div>
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-border bg-muted/20">
          <p className="text-xs text-muted-foreground">
            {rangeLabel}
            {searchQuery &&
              ` · Filtered by "${searchQuery}" (${filteredLogs.length} matching)`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => changePage(Math.max(1, page - 1))}
              disabled={!hasPrevious}
              className="h-8 text-xs rounded-lg"
            >
              Previous
            </Button>
            <span className="text-xs font-semibold px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => changePage(page + 1)}
              disabled={!hasNext}
              className="h-8 text-xs rounded-lg"
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
