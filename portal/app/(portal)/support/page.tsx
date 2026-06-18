"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SupportListSkeleton } from "@/components/skeletons/support-skeleton";
import { CreateSupportRequestModal } from "@/components/create-support-request-modal";
import {
  type SupportRequest,
  type PaginatedResponse,
  getMyRequests,
  getDepartmentRequests,
} from "@/lib/api/support";
import { extractApiErrorMessage } from "@/lib/api-errors";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  assigned:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  in_progress:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  resolved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "in_progress", label: "In Progress" },
  { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" },
] as const;

const ITEMS_PER_PAGE = 10;

export default function SupportListPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "department">("mine");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  const counts = useMemo(() => {
    const count: Record<string, number> = {};
    for (const req of requests) {
      count[req.status] = (count[req.status] || 0) + 1;
    }
    count.all = requests.length;
    return count;
  }, [requests]);

  return (
    <div className="flex items-start w-full max-w-6xl gap-6 mx-auto">
      {/* Sidebar filters */}
      <aside className="flex w-64 shrink-0 flex-col gap-1 rounded-xl border border-sidebar-border bg-sidebar p-3 text-sidebar-foreground shadow-sm">
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60">
          Status
        </p>
        {STATUS_FILTERS.map(({ key, label }) => {
          const isActive = statusFilter === key;
          const badgeCount = counts[key] ?? 0;
          return (
            <button
              key={key}
              onClick={() => {
                setStatusFilter(key);
                setCurrentPage(1);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
            >
              <span>{label}</span>
              {badgeCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-sidebar-foreground/15 text-[11px] font-semibold text-sidebar-foreground/60">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </aside>

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-6 pt-2">
        {/* Header */}
        <div className="flex items-center justify-end">
          <CreateSupportRequestModal />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-4 border-b pb-3">
          <button
            onClick={() => {
              setTab("mine");
              setCurrentPage(1);
            }}
            className={`text-sm font-medium transition-colors ${
              tab === "mine"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            My Requests
          </button>
          {isLineManager && (
            <button
              onClick={() => {
                setTab("department");
                setCurrentPage(1);
              }}
              className={`text-sm font-medium transition-colors ${
                tab === "department"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Department
            </button>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <SupportListSkeleton />
        ) : error ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {error}
            </CardContent>
          </Card>
        ) : requests.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <p className="text-lg font-medium">No requests found</p>
              <p className="mt-1 text-sm">
                There are no{" "}
                {statusFilter !== "all"
                  ? statusFilter.replace("_", " ") + " "
                  : ""}
                requests{tab === "mine" ? "" : " in this department"}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <button
                key={req.id}
                onClick={() => router.push(`/support/${req.id}`)}
                className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{req.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {req.requester.full_name} &middot; {req.department.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge
                      className={STATUS_COLORS[req.status] || ""}
                      variant="outline"
                    >
                      {req.status.replace("_", " ")}
                    </Badge>
                    <Badge
                      className={PRIORITY_COLORS[req.priority] || ""}
                      variant="outline"
                    >
                      {req.priority}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore && (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  )}
                  Load More
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
