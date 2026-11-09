"use client";

import Link from "next/link";
import { format, formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Calendar,
  Eye,
  MessageSquare,
  RotateCcw,
  Search,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { AllReportsSkeleton } from "@/components/skeletons/reports-skeleton";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  reportsAPI,
  type DailyReportDetail,
  type DepartmentReportsAllParams,
} from "@/lib/api/reports";
import { cn } from "@/lib/utils";

type DateFilterMode =
  | "all"
  | "last_1_day"
  | "last_7_days"
  | "last_30_days"
  | "date"
  | "range";

type DateGroup = {
  date: string;
  reports: DailyReportDetail[];
};

function getInitials(name?: string, username?: string) {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (username) {
    return username.slice(0, 2).toUpperCase();
  }
  return "U";
}

function formatDateHeader(dateStr: string) {
  try {
    const parsed = parseISO(dateStr);
    if (Number.isNaN(parsed.getTime())) {
      return { label: dateStr, relative: null };
    }

    let relative: string | null = null;
    if (isToday(parsed)) {
      relative = "Today";
    } else if (isYesterday(parsed)) {
      relative = "Yesterday";
    }

    const label = format(parsed, "EEEE, MMMM d, yyyy");
    return { label, relative };
  } catch {
    return { label: dateStr, relative: null };
  }
}

function getRelativeDateRange(days: number) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);

  return {
    date_from: format(start, "yyyy-MM-dd"),
    date_to: format(end, "yyyy-MM-dd"),
  };
}

export default function AllReportsPage() {
  const [dateGroups, setDateGroups] = useState<DateGroup[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [totalDates, setTotalDates] = useState(0);
  const [totalReports, setTotalReports] = useState(0);

  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Filters state
  const [filterMode, setFilterMode] = useState<DateFilterMode>("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [filterError, setFilterError] = useState<string | null>(null);

  // User search query (local input & debounced search)
  const [userSearch, setUserSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isFetchingRef = useRef(false);

  // Debounce user search input by 350ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(userSearch.trim());
    }, 350);
    return () => clearTimeout(timer);
  }, [userSearch]);

  // Compute active API query params for current filters
  const activeParams = useMemo<DepartmentReportsAllParams>(() => {
    const params: DepartmentReportsAllParams = {};

    if (debouncedSearch) {
      params.search = debouncedSearch;
    }

    if (filterMode === "last_1_day") {
      const { date_from, date_to } = getRelativeDateRange(1);
      params.date_from = date_from;
      params.date_to = date_to;
    } else if (filterMode === "last_7_days") {
      const { date_from, date_to } = getRelativeDateRange(7);
      params.date_from = date_from;
      params.date_to = date_to;
    } else if (filterMode === "last_30_days") {
      const { date_from, date_to } = getRelativeDateRange(30);
      params.date_from = date_from;
      params.date_to = date_to;
    } else if (filterMode === "date" && selectedDate) {
      params.date = selectedDate;
    } else if (filterMode === "range" && rangeStart && rangeEnd) {
      params.date_from = rangeStart;
      params.date_to = rangeEnd;
    }

    return params;
  }, [debouncedSearch, filterMode, selectedDate, rangeStart, rangeEnd]);

  // Fetch a specific page (date)
  const fetchPage = useCallback(
    async (pageToFetch: number, isInitial: boolean) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;

      try {
        if (isInitial) {
          setIsLoading(true);
          setErrorMessage(null);
        } else {
          setIsLoadingMore(true);
        }

        const data = await reportsAPI.getAll({
          ...activeParams,
          page: pageToFetch,
        });

        setTotalDates(data.total_dates);
        setTotalReports(data.total_reports);
        setHasNextPage(data.has_next);
        setCurrentPage(data.page);

        if (data.current_date && data.results.length > 0) {
          const newGroup: DateGroup = {
            date: data.current_date,
            reports: data.results,
          };

          setDateGroups((prev) => {
            if (isInitial) {
              return [newGroup];
            }
            // Avoid duplicate dates if any race occurred
            if (prev.some((g) => g.date === newGroup.date)) {
              return prev;
            }
            return [...prev, newGroup];
          });
        } else if (isInitial) {
          setDateGroups([]);
        }
      } catch (err) {
        const msg = extractApiErrorMessage(err, "Failed to load reports.");
        if (isInitial) {
          setErrorMessage(msg);
        } else {
          toast.error(msg);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
        isFetchingRef.current = false;
      }
    },
    [activeParams],
  );

  // Reload from page 1 whenever active filters or search change
  useEffect(() => {
    void fetchPage(1, true);
  }, [fetchPage]);

  // Infinite scroll intersection observer
  useEffect(() => {
    if (!hasNextPage || isLoading || isLoadingMore) {
      return;
    }

    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isFetchingRef.current) {
          void fetchPage(currentPage + 1, false);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [currentPage, hasNextPage, isLoading, isLoadingMore, fetchPage]);

  function handlePresetFilter(mode: DateFilterMode) {
    setFilterError(null);
    setFilterMode(mode);
    if (mode !== "date") {
      setSelectedDate("");
    }
    if (mode !== "range") {
      setRangeStart("");
      setRangeEnd("");
    }
  }

  function handleApplyCustomRange() {
    setFilterError(null);
    if (!rangeStart || !rangeEnd) {
      setFilterError("Choose both start and end dates.");
      return;
    }
    if (rangeStart > rangeEnd) {
      setFilterError("Start date must be before or equal to end date.");
      return;
    }
  }

  function handleResetFilters() {
    setFilterError(null);
    setFilterMode("all");
    setSelectedDate("");
    setRangeStart("");
    setRangeEnd("");
    setUserSearch("");
  }

  const hasActiveFilters =
    filterMode !== "all" || Boolean(debouncedSearch.trim());

  if (isLoading && dateGroups.length === 0 && !errorMessage) {
    return <AllReportsSkeleton />;
  }

  if (errorMessage) {
    return (
      <PageErrorCard
        title="Failed to load department reports"
        message={errorMessage}
        onRetry={() => fetchPage(1, true)}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* 1. Header Navigation */}
      <div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full gap-2 text-xs text-muted-foreground hover:text-foreground"
          asChild
        >
          <Link href="/reports">
            <ArrowLeft className="size-3.5" />
            Back to calendar
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Department Daily Reports
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse, filter, and audit all submitted reports across your department, paginated by date.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] border border-[#0d47a1]/20">
            <Users className="size-3.5" />
            {totalReports} {totalReports === 1 ? "report" : "reports"} across {totalDates}{" "}
            {totalDates === 1 ? "day" : "days"}
          </span>
        </div>
      </div>

      {/* 2. Filter Toolbar */}
      <Card className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => handlePresetFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "all"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              All Reports
            </button>
            <button
              type="button"
              onClick={() => handlePresetFilter("last_1_day")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_1_day"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Last 24 Hours
            </button>
            <button
              type="button"
              onClick={() => handlePresetFilter("last_7_days")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_7_days"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => handlePresetFilter("last_30_days")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "last_30_days"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => handlePresetFilter("date")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "date"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Specific Date
            </button>
            <button
              type="button"
              onClick={() => handlePresetFilter("range")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                filterMode === "range"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Date Range
            </button>
          </div>

          {/* User Search Input */}
          <div className="relative min-w-[240px] lg:max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search by username or email..."
              className="h-9 pl-9 pr-8 rounded-lg bg-background/50 border-input text-xs"
            />
            {userSearch && (
              <button
                type="button"
                onClick={() => setUserSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Clear user search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Date Inputs if Date or Range mode */}
        {(filterMode === "date" || filterMode === "range") && (
          <div className="flex flex-wrap items-end gap-3 pt-3 border-t border-border/50">
            {filterMode === "date" ? (
              <div className="space-y-1">
                <Label
                  htmlFor="report-filter-date"
                  className="text-xs text-muted-foreground"
                >
                  Select Date
                </Label>
                <Input
                  id="report-filter-date"
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
                    htmlFor="report-filter-start"
                    className="text-xs text-muted-foreground"
                  >
                    Start Date
                  </Label>
                  <Input
                    id="report-filter-start"
                    type="date"
                    value={rangeStart}
                    onChange={(e) => setRangeStart(e.target.value)}
                    className="h-9 text-xs rounded-lg bg-background/50 border-input w-44"
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="report-filter-end"
                    className="text-xs text-muted-foreground"
                  >
                    End Date
                  </Label>
                  <Input
                    id="report-filter-end"
                    type="date"
                    value={rangeEnd}
                    onChange={(e) => setRangeEnd(e.target.value)}
                    className="h-9 text-xs rounded-lg bg-background/50 border-input w-44"
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyCustomRange}
                  className="h-9 text-xs font-semibold"
                >
                  Apply Range
                </Button>
              </>
            )}

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-9 text-xs text-muted-foreground hover:text-foreground gap-1.5"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            )}
          </div>
        )}

        {filterError && (
          <p className="text-xs text-destructive font-medium">{filterError}</p>
        )}
      </Card>

      {/* 3. Reports Feed Grouped By Date */}
      {dateGroups.length === 0 ? (
        <Card className="rounded-xl border border-dashed border-border bg-card p-12 text-center shadow-xs">
          <Calendar className="mx-auto size-10 text-muted-foreground/60 mb-3" />
          <h2 className="text-base font-semibold text-foreground">
            No department reports found
          </h2>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {hasActiveFilters
              ? "No reports match the selected date or user search criteria."
              : "No reports have been submitted for your department yet."}
          </p>
          {hasActiveFilters && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="text-xs gap-1.5"
              >
                <RotateCcw className="size-3.5" />
                Clear filters
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <div className="space-y-8">
          {dateGroups.map((group) => {
            const { label, relative } = formatDateHeader(group.date);
            return (
              <section key={group.date} className="space-y-3">
                {/* Date Section Banner */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                      <Calendar className="size-4" />
                    </div>
                    <h2 className="text-base font-semibold text-foreground tracking-tight">
                      {label}
                    </h2>
                    {relative && (
                      <span className="rounded-md bg-[#0d47a1] px-2 py-0.5 text-[11px] font-semibold text-white">
                        {relative}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {group.reports.length}{" "}
                      {group.reports.length === 1 ? "report" : "reports"} submitted
                    </span>
                    <Button variant="ghost" size="sm" asChild className="h-7 text-xs px-2">
                      <Link href={`/reports/${group.date}`}>
                        Open hub
                      </Link>
                    </Button>
                  </div>
                </div>

                {/* Cards for Reports on this Date */}
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.reports.map((report) => {
                    const initials = getInitials(
                      report.creator.full_name,
                      report.creator.username,
                    );
                    return (
                      <Card
                        key={report.id}
                        className="rounded-xl border border-border/70 bg-card p-4 transition-all duration-200 shadow-xs hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between"
                      >
                        <div className="space-y-3">
                          {/* User Info Header */}
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-xs font-bold text-[#0d47a1] dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]">
                                {initials}
                              </div>
                              <div className="min-w-0 truncate">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {report.creator.full_name || report.creator.username}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {report.creator.email}
                                </p>
                              </div>
                            </div>
                            <span className="shrink-0 rounded-md border border-[#16a34a]/25 bg-[#16a34a]/10 px-2 py-0.5 text-[11px] font-semibold text-[#16a34a] dark:text-[#4ade80]">
                              {report.subreport_count}{" "}
                              {report.subreport_count === 1 ? "entry" : "entries"}
                            </span>
                          </div>

                          {/* Subreports Preview */}
                          {report.subreports && report.subreports.length > 0 ? (
                            <div className="space-y-1.5 pt-1">
                              {report.subreports.slice(0, 2).map((sub) => (
                                <div
                                  key={sub.id}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                                >
                                  <span className="truncate font-medium text-foreground">
                                    {sub.title}
                                  </span>
                                  {sub.comments_count > 0 && (
                                    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                                      <MessageSquare className="size-3" />
                                      {sub.comments_count}
                                    </span>
                                  )}
                                </div>
                              ))}
                              {report.subreports.length > 2 && (
                                <p className="text-[11px] text-muted-foreground pl-1">
                                  +{report.subreports.length - 2} more entries
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">
                              {report.title || "No subreports recorded."}
                            </p>
                          )}
                        </div>

                        {/* Card Footer */}
                        <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3 text-xs text-muted-foreground">
                          <span title={report.created_at}>
                            {formatDistanceToNow(parseISO(report.created_at), {
                              addSuffix: true,
                            })}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 rounded-lg text-xs font-semibold"
                            asChild
                          >
                            <Link href={report.view_url}>
                              View
                              <Eye className="size-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 4. Infinite Scroll Sentinel and Loaders */}
      <InfiniteScrollLoader isLoading={isLoadingMore} entityName="reports" />

      {hasNextPage && <div ref={loadMoreRef} className="h-10" />}

      {!hasNextPage && dateGroups.length > 0 && (
        <div className="py-6 text-center text-xs text-muted-foreground border-t border-border/40">
          All department reports have been loaded.
        </div>
      )}
    </div>
  );
}

