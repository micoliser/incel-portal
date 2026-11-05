"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  LifeBuoy,
  Laptop,
  HelpCircle,
  Clock,
  User,
  Search,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  ChevronRight,
  Inbox,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SupportListSkeleton } from "@/components/skeletons/support-skeleton";
import { CreateSupportRequestModal } from "@/components/create-support-request-modal";
import {
  type SupportRequest,
  type PaginatedResponse,
  getMyRequests,
  getDepartmentRequests,
} from "@/lib/api/support";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  string,
  { label: string; badgeClass: string; dotClass: string }
> = {
  open: {
    label: "Open",
    badgeClass:
      "border-[#0d47a1]/30 bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] dark:border-[#0d47a1]/40",
    dotClass: "bg-[#0d47a1] dark:bg-[#38bdf8]",
  },
  assigned: {
    label: "Assigned",
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/40",
    dotClass: "bg-amber-500",
  },
  in_progress: {
    label: "In Progress",
    badgeClass:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/40",
    dotClass: "bg-sky-500",
  },
  resolved: {
    label: "Resolved",
    badgeClass:
      "border-[#16a34a]/30 bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80] dark:border-[#16a34a]/40",
    dotClass: "bg-[#16a34a]",
  },
  closed: {
    label: "Closed",
    badgeClass:
      "border-border bg-muted/80 text-muted-foreground dark:bg-muted/40",
    dotClass: "bg-muted-foreground",
  },
};

const PRIORITY_CONFIG: Record<
  string,
  { label: string; badgeClass: string }
> = {
  low: {
    label: "Low",
    badgeClass: "border-border bg-muted/60 text-muted-foreground",
  },
  medium: {
    label: "Medium",
    badgeClass:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  },
  high: {
    label: "High",
    badgeClass:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300 font-medium",
  },
  urgent: {
    label: "Urgent",
    badgeClass:
      "border-[#dc2626]/30 bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/20 dark:text-red-400 font-semibold animate-pulse",
  },
};

const STATUS_FILTERS = [
  { key: "all", label: "All Status" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
] as const;

const ITEMS_PER_PAGE = 10;

function formatRequestDate(dateStr: string) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return dateStr;
  }
}

export default function SupportListPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "department">("mine");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // Determine if user is a line manager from first request's can_manage field
  const isLineManager = useMemo(
    () => requests.some((r) => r.can_manage),
    [requests],
  );

  const loadData = useCallback(
    async (page: number, append: boolean) => {
      try {
        if (append) {
          setLoadingMore(true);
        } else {
          setLoading(true);
          setRequests([]);
        }
        setError(null);

        const params: { status?: string; page?: number } = {};
        if (statusFilter !== "all") params.status = statusFilter;
        params.page = page;

        let response: PaginatedResponse<SupportRequest>;
        if (tab === "mine") {
          response = await getMyRequests(params);
        } else {
          response = await getDepartmentRequests(params);
        }

        const results = Array.isArray(response.results) ? response.results : [];
        setRequests((prev) => (append ? [...prev, ...results] : results));
        setTotalCount(response.count ?? 0);
        setHasMore(Boolean(response.next) || results.length >= ITEMS_PER_PAGE);
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load requests."));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [statusFilter, tab],
  );

  useEffect(() => {
    setCurrentPage(1);
    void loadData(1, false);
  }, [loadData]);

  function handleLoadMore() {
    const nextPage = currentPage + 1;
    setCurrentPage(nextPage);
    void loadData(nextPage, true);
  }

  // Filter requests locally by search query if typed
  const filteredRequests = useMemo(() => {
    if (!searchQuery.trim()) return requests;
    const q = searchQuery.toLowerCase();
    return requests.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.requester?.full_name?.toLowerCase().includes(q) ||
        r.department?.name?.toLowerCase().includes(q),
    );
  }, [requests, searchQuery]);

  // Statistics calculation for overview cards
  const stats = useMemo(() => {
    let openCount = 0;
    let inProgressCount = 0;
    let resolvedCount = 0;
    let urgentCount = 0;

    for (const req of requests) {
      if (req.status === "open" || req.status === "assigned") openCount++;
      if (req.status === "in_progress") inProgressCount++;
      if (req.status === "resolved" || req.status === "closed") resolvedCount++;
      if (req.priority === "urgent" || req.priority === "high") urgentCount++;
    }

    return {
      total: totalCount || requests.length,
      open: openCount,
      inProgress: inProgressCount,
      resolved: resolvedCount,
      urgent: urgentCount,
    };
  }, [requests, totalCount]);

  const counts = useMemo(() => {
    const count: Record<string, number> = {};
    for (const req of requests) {
      count[req.status] = (count[req.status] || 0) + 1;
    }
    count.all = requests.length;
    return count;
  }, [requests]);

  return (
    <div className="space-y-6 max-w-full">
      {/* 1. Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Support Center
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Submit, track, and resolve operational and technical requests.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <CreateSupportRequestModal />
        </div>
      </div>

      {/* 2. Operational Metrics Overview */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Total Requests */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Requests
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <LifeBuoy className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground">in current view</span>
          </div>
        </Card>

        {/* Open Requests */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Awaiting Action
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-300">
              <Clock className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.open}
            </span>
            <span className="text-xs text-muted-foreground">open / assigned</span>
          </div>
        </Card>

        {/* In Progress */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              In Progress
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300">
              <AlertCircle className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.inProgress}
            </span>
            <span className="text-xs text-muted-foreground">active handling</span>
          </div>
        </Card>

        {/* Resolved / Closed */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Resolved & Closed
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80]">
              <CheckCircle2 className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.resolved}
            </span>
            <span className="text-xs text-[#16a34a] font-medium">completed</span>
          </div>
        </Card>
      </div>

      {/* 3. Navigation Tabs & Search/Filter Toolbar */}
      <div className="flex flex-col gap-4">
        {/* Top View Selector Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => {
                setTab("mine");
                setCurrentPage(1);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all",
                tab === "mine"
                  ? "bg-[#0d47a1] text-white shadow-xs hover:bg-[#0a3880]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
              )}
            >
              <User className="size-3.5" />
              <span>My Requests</span>
              {tab === "mine" && requests.length > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-bold">
                  {requests.length}
                </span>
              )}
            </button>

            {isLineManager && (
              <button
                type="button"
                onClick={() => {
                  setTab("department");
                  setCurrentPage(1);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all",
                  tab === "department"
                    ? "bg-[#0d47a1] text-white shadow-xs hover:bg-[#0a3880]"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/80",
                )}
              >
                <Building2 className="size-3.5" />
                <span>Department Requests</span>
                {tab === "department" && requests.length > 0 && (
                  <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px] font-bold">
                    {requests.length}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Quick Search Input */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by title or requester..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg pl-9 text-xs sm:text-sm bg-card border-border"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Status Filter Horizontal Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {STATUS_FILTERS.map(({ key, label }) => {
            const isActive = statusFilter === key;
            const badgeCount = counts[key] ?? 0;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setStatusFilter(key);
                  setCurrentPage(1);
                }}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                  isActive
                    ? "border-[#0d47a1] bg-[#0d47a1] text-white shadow-xs font-semibold"
                    : "border-border bg-card text-muted-foreground hover:border-border/80 hover:text-foreground hover:bg-muted/50",
                )}
              >
                <span>{label}</span>
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      "flex size-4.5 items-center justify-center rounded-full text-[10px] font-bold",
                      isActive
                        ? "bg-white/25 text-white"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Requests List / States */}
      {loading ? (
        <SupportListSkeleton />
      ) : error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
          <AlertCircle className="mx-auto size-8 text-destructive mb-2" />
          <h3 className="text-base font-semibold text-foreground">
            Failed to load support requests
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void loadData(1, false)}
          >
            Try Again
          </Button>
        </Card>
      ) : filteredRequests.length === 0 ? (
        <Card className="rounded-xl border border-border bg-card p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground mb-3">
            <Inbox className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            No support requests found
          </h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
            {searchQuery
              ? `No requests matching "${searchQuery}".`
              : statusFilter !== "all"
                ? `No ${statusFilter.replace("_", " ")} requests in this view.`
                : tab === "mine"
                  ? "You have not submitted any support requests yet."
                  : "No support requests have been submitted for your department."}
          </p>
          <div className="mt-5 flex justify-center">
            <CreateSupportRequestModal />
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRequests.map((req) => {
            const statusConfig = STATUS_CONFIG[req.status] || STATUS_CONFIG.open;
            const priorityConfig =
              PRIORITY_CONFIG[req.priority] || PRIORITY_CONFIG.medium;
            const isIT = req.category === "IT_SUPPORT";

            return (
              <div
                key={req.id}
                onClick={() => router.push(`/support/${req.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/support/${req.id}`);
                  }
                }}
                className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:p-5 text-left shadow-xs transition-all duration-200 hover:border-[#0d47a1]/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0d47a1]/30"
              >
                {/* Card Top Row: Meta badges & Time */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Category Badge */}
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium text-foreground">
                      {isIT ? (
                        <Laptop className="size-3 text-[#0d47a1] dark:text-[#38bdf8]" />
                      ) : (
                        <HelpCircle className="size-3 text-amber-600 dark:text-amber-400" />
                      )}
                      <span>{isIT ? "IT Support" : "General"}</span>
                    </span>

                    {/* Status Badge */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
                        statusConfig.badgeClass,
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", statusConfig.dotClass)}
                      />
                      <span>{statusConfig.label}</span>
                    </span>

                    {/* Priority Badge */}
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs",
                        priorityConfig.badgeClass,
                      )}
                    >
                      {priorityConfig.label}
                    </span>
                  </div>

                  {/* Created timestamp */}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="size-3.5" />
                    <span>{formatRequestDate(req.created_at)}</span>
                  </div>
                </div>

                {/* Card Main: Title & Description Snippet */}
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground group-hover:text-[#0d47a1] transition-colors line-clamp-1">
                    {req.title}
                  </h3>
                  {req.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                      {req.description}
                    </p>
                  )}
                </div>

                {/* Card Footer: Requester & Assignee & Action Indicator */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Requester */}
                    <div className="flex items-center gap-1.5">
                      <div className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-foreground">
                        {req.requester.full_name?.charAt(0) || "U"}
                      </div>
                      <span className="font-medium text-foreground">
                        {req.requester.full_name}
                      </span>
                      <span>&middot;</span>
                      <span>{req.department.name}</span>
                    </div>

                    {/* Assignee */}
                    {req.assigned_to ? (
                      <div className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-0.5">
                        <span className="text-muted-foreground">Assigned:</span>
                        <span className="font-medium text-foreground">
                          {req.assigned_to.full_name}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/70 italic">
                        Unassigned
                      </span>
                    )}
                  </div>

                  {/* View Details Hover Affordance */}
                  <div className="flex items-center gap-1 text-xs font-medium text-[#0d47a1] dark:text-[#38bdf8] opacity-80 group-hover:opacity-100 transition-opacity">
                    <span>View ticket</span>
                    <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Load More Pagination */}
          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="rounded-lg h-9 px-4 font-medium"
              >
                {loadingMore && <Loader2 className="mr-2 size-4 animate-spin" />}
                Load More Requests
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
