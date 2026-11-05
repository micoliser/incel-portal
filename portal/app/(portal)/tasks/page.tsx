"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format, isPast } from "date-fns";
import {
  Plus,
  AlertCircle,
  Bookmark,
  Trash2,
  Edit3,
  Clock,
  Users,
  Repeat,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import {
  getRecurringSchedules,
  getTasks,
  getTaskDrafts,
  deleteTaskDraft,
  type RecurringSchedule,
  type Task,
  type TaskDraft,
} from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { TasksSkeleton, TaskCardSkeleton } from "@/components/skeletons/tasks-skeleton";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateTaskModal } from "@/components/create-task-modal";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

function getInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const statusConfig: Record<
  Task["status"],
  { label: string; badgeClass: string; dotClass: string }
> = {
  pending: {
    label: "Pending",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-500",
  },
  in_progress: {
    label: "In Progress",
    badgeClass: "border-[#0d47a1]/25 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]",
    dotClass: "bg-[#0d47a1] dark:bg-[#38bdf8]",
  },
  under_review: {
    label: "Under Review",
    badgeClass: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    dotClass: "bg-purple-500",
  },
  completed: {
    label: "Completed",
    badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
  },
};

const priorityConfig: Record<
  Task["priority"],
  { label: string; badgeClass: string }
> = {
  low: {
    label: "Low",
    badgeClass: "border-border/70 bg-muted/50 text-muted-foreground",
  },
  medium: {
    label: "Medium",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  high: {
    label: "High",
    badgeClass: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400 font-semibold",
  },
};

const statusFilterOptions: Array<{ value: Task["status"]; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "under_review", label: "Under Review" },
  { value: "completed", label: "Completed" },
];

const priorityFilterOptions: Array<{
  value: Task["priority"];
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export default function TasksPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [createdRecurringSchedules, setCreatedRecurringSchedules] = useState<
    RecurringSchedule[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasInitialLoadCompleted = useRef(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeView, setActiveView] = useState<
    "assigned" | "created" | "team" | "drafts"
  >(
    searchParams.get("view") === "created"
      ? "created"
      : searchParams.get("view") === "team"
        ? "team"
        : searchParams.get("view") === "drafts"
          ? "drafts"
          : "assigned",
  );
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<TaskDraft | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<Task["status"][]>(
    [],
  );
  const [selectedPriorities, setSelectedPriorities] = useState<
    Task["priority"][]
  >([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [managerScope, setManagerScope] = useState<{
    role_type: "global" | "department" | "unit" | "team";
    title: string;
    scope_name: string;
    description: string;
  } | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isRequestInFlightRef = useRef(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profileResponse = await apiClient.get("/me");
        setCurrentUserId(profileResponse.data.id ?? null);
        setIsManager(
          Boolean(
            profileResponse.data.is_manager ||
              profileResponse.data.has_global_access,
          ),
        );
        setManagerScope(profileResponse.data.manager_scope ?? null);
      } catch {
        setCurrentUserId(null);
        setIsManager(false);
        setManagerScope(null);
      }
    };

    fetchProfile();
  }, []);

  useEffect(() => {
    const loadRecurringSchedules = async () => {
      if (activeView !== "created" || currentUserId == null) {
        setCreatedRecurringSchedules([]);
        return;
      }

      try {
        const response = await getRecurringSchedules();
        const schedules = response.results.filter(
          (item) => item.assigned_by.id === currentUserId,
        );
        setCreatedRecurringSchedules(schedules);
      } catch (err) {
        const message =
          extractApiErrorMessage(err, "Failed to load recurring schedules");
        toast.error(message);
      }
    };

    loadRecurringSchedules();
  }, [activeView, currentUserId, reloadToken]);

  const loadDrafts = async () => {
    try {
      setLoadingDrafts(true);
      const data = await getTaskDrafts();
      setDrafts(data);
    } catch {
      // ignore
    } finally {
      setLoadingDrafts(false);
    }
  };

  useEffect(() => {
    loadDrafts();
  }, [reloadToken]);

  const handleDeleteDraft = async (draftId: string) => {
    try {
      await deleteTaskDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      toast.success("Draft deleted");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to delete draft"));
    }
  };

  useEffect(() => {
    setTasks([]);
    setCurrentPage(1);
    setHasNextPage(false);
  }, [activeView, selectedStatuses, selectedPriorities]);

  useEffect(() => {
    const loadTasks = async () => {
      if (activeView === "drafts") {
        setLoading(false);
        setIsLoadingMore(false);
        return;
      }

      try {
        isRequestInFlightRef.current = true;
        if (!hasInitialLoadCompleted.current) {
          setLoading(true);
        } else if (currentPage === 1) {
          setIsFiltering(true);
        } else {
          setIsLoadingMore(true);
        }

        const taskData = await getTasks({
          view: activeView,
          status: selectedStatuses,
          priority: selectedPriorities,
          page: currentPage,
        });

        setTasks((current) =>
          currentPage === 1
            ? taskData.results
            : [...current, ...taskData.results],
        );
        setHasNextPage(Boolean(taskData.next));
        setLoadError(null);
        setError(null);
      } catch (err) {
        const message =
          extractApiErrorMessage(err, "Failed to load tasks");
        toast.error(message);
        if (currentPage === 1) {
          setLoadError(message);
        }
      } finally {
        isRequestInFlightRef.current = false;
        hasInitialLoadCompleted.current = true;
        setLoading(false);
        setIsFiltering(false);
        setIsLoadingMore(false);
      }
    };

    loadTasks();
  }, [
    activeView,
    currentPage,
    reloadToken,
    selectedPriorities,
    selectedStatuses,
  ]);

  useEffect(() => {
    if (!hasNextPage || loading || isLoadingMore) {
      return;
    }

    const element = loadMoreRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isRequestInFlightRef.current) {
          return;
        }

        setCurrentPage((page) => page + 1);
      },
      { threshold: 0.1 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isLoadingMore, loading]);

  const hasActiveFilters =
    selectedStatuses.length > 0 || selectedPriorities.length > 0;
  const emptyTitle =
    tasks.length === 0 && hasActiveFilters
      ? "No Matching Tasks"
      : activeView === "assigned"
        ? "No Assigned Tasks"
        : activeView === "created"
          ? "No Created Tasks"
          : "No Team Tasks";

  const emptyMessage =
    tasks.length === 0 && hasActiveFilters
      ? "No tasks match the selected filters"
      : activeView === "assigned"
        ? "No tasks assigned to you"
        : activeView === "created"
          ? "No tasks created by you"
          : "No active tasks found across your team";

  const toggleStatusFilter = (status: Task["status"]) => {
    setSelectedStatuses((current) =>
      current.includes(status)
        ? current.filter((value) => value !== status)
        : [...current, status],
    );
  };

  const togglePriorityFilter = (priority: Task["priority"]) => {
    setSelectedPriorities((current) =>
      current.includes(priority)
        ? current.filter((value) => value !== priority)
        : [...current, priority],
    );
  };

  if (loading && !hasInitialLoadCompleted.current) {
    return <TasksSkeleton />;
  }

  if (loadError) {
    return (
      <PageErrorCard
        title="Failed to load tasks"
        message={loadError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex max-w-full items-center overflow-x-auto rounded-xl border border-border bg-muted/60 p-1 scrollbar-none">
          <Button
            type="button"
            size="sm"
            variant={activeView === "assigned" ? "default" : "ghost"}
            className="rounded-lg flex-shrink-0 text-xs sm:text-sm h-8 sm:h-9 font-medium"
            onClick={() => {
              setActiveView("assigned");
              router.push("?view=assigned");
            }}
          >
            Assigned to Me
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeView === "created" ? "default" : "ghost"}
            className="rounded-lg flex-shrink-0 text-xs sm:text-sm h-8 sm:h-9 font-medium"
            onClick={() => {
              setActiveView("created");
              router.push("?view=created");
            }}
          >
            Created by Me
          </Button>
          {isManager && (
            <Button
              type="button"
              size="sm"
              variant={activeView === "team" ? "default" : "ghost"}
              className="rounded-lg gap-1.5 flex-shrink-0 text-xs sm:text-sm h-8 sm:h-9 font-medium"
              onClick={() => {
                setActiveView("team");
                router.push("?view=team");
              }}
            >
              <Users className="h-3.5 w-3.5" />
              Team Tasks
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={activeView === "drafts" ? "default" : "ghost"}
            className="rounded-lg gap-1.5 flex-shrink-0 text-xs sm:text-sm h-8 sm:h-9 font-medium"
            onClick={() => {
              setActiveView("drafts");
              router.push("?view=drafts");
            }}
          >
            <Bookmark className="h-3.5 w-3.5" />
            Drafts
            {drafts.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] sm:text-xs font-semibold text-primary">
                {drafts.length}
              </span>
            )}
          </Button>
        </div>

        <Button
          onClick={() => {
            setSelectedDraft(null);
            setCreateModalOpen(true);
          }}
          className="gap-2 w-full sm:w-auto h-9 font-semibold"
        >
          <Plus className="h-4 w-4" />
          Create Task
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/10 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-[#dc2626] flex-shrink-0 mt-0.5" />
          <div className="text-[#dc2626] text-sm font-medium">{error}</div>
        </div>
      )}

      {activeView === "team" && (
        <div className="flex items-start sm:items-center gap-3.5 rounded-xl border border-[#0d47a1]/25 bg-[#0d47a1]/8 p-3.5 sm:p-4 text-sm text-foreground shadow-xs max-w-full">
          <div className="flex h-9 w-9 sm:h-10 sm:w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/15 text-[#0d47a1] dark:text-[#38bdf8]">
            <Users className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground break-words text-xs sm:text-sm">
              {managerScope
                ? `${managerScope.title}: ${managerScope.scope_name}`
                : "Team Oversight"}
            </p>
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 break-words">
              {managerScope?.description ||
                "Viewing all tasks related to your team members."}
            </p>
          </div>
        </div>
      )}

      {activeView !== "drafts" && (
        <Card className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground mr-1">Status:</span>
            {statusFilterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={
                  selectedStatuses.includes(option.value) ? "default" : "outline"
                }
                className="h-8 text-xs"
                onClick={() => toggleStatusFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground mr-1">Priority:</span>
            {priorityFilterOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={
                  selectedPriorities.includes(option.value)
                    ? "default"
                    : "outline"
                }
                className="h-8 text-xs"
                onClick={() => togglePriorityFilter(option.value)}
              >
                {option.label}
              </Button>
            ))}

            {hasActiveFilters && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setSelectedStatuses([]);
                  setSelectedPriorities([]);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </Card>
      )}

      {activeView === "drafts" ? (
        <div>
          {loadingDrafts ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="rounded-xl border border-border/80 p-5 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Skeleton className="h-5 w-24 rounded-full" />
                      <Skeleton className="h-4 w-16 rounded-md" />
                    </div>
                    <Skeleton className="h-5 w-3/4 rounded" />
                    <Skeleton className="h-3.5 w-full rounded" />
                    <Skeleton className="h-3.5 w-4/5 rounded" />
                  </div>
                  <div className="pt-3 border-t border-border/70 flex items-center justify-between">
                    <Skeleton className="h-3.5 w-24 rounded" />
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-16 rounded-lg" />
                      <Skeleton className="h-8 w-20 rounded-lg" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center px-6 text-center">
              <div className="max-w-md rounded-2xl border border-dashed border-border bg-card/50 p-8 text-center space-y-3 shadow-2xs">
                <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                  <Bookmark className="size-6 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-foreground">
                    No Saved Drafts
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Unfinished task forms and saved drafts will automatically appear here so you can resume them at any time.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {drafts.map((draft) => (
                <Card
                  key={draft.id}
                  className="group flex h-full w-full min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0d47a1]/40 hover:shadow-md hover:shadow-[#0d47a1]/5"
                >
                  <div className="space-y-3 min-w-0">
                    {/* Top tags bar */}
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        Draft
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          {draft.mode === "recurring" ? (
                            <>
                              <Repeat className="size-3 text-[#0d47a1] dark:text-[#38bdf8]" />
                              Recurring
                            </>
                          ) : (
                            "One-time"
                          )}
                        </span>
                        {draft.priority && (
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
                              priorityConfig[draft.priority]?.badgeClass || "border-border bg-muted",
                            )}
                          >
                            {draft.priority}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Title & Description */}
                    <div className="space-y-1.5">
                      <h3 className="text-sm sm:text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8] line-clamp-1 break-words">
                        {draft.title.trim() || (
                          <span className="italic text-muted-foreground font-normal">
                            Untitled Draft
                          </span>
                        )}
                      </h3>
                      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 break-words">
                        {draft.description || "No description written yet."}
                      </p>
                    </div>

                    {/* Metadata tokens */}
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
                      {draft.assigned_to_users && draft.assigned_to_users.length > 0 ? (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          <Users className="size-3 text-[#0d47a1] dark:text-[#38bdf8]" />
                          <span>
                            {draft.assigned_to_users.length} assignee
                            {draft.assigned_to_users.length > 1 ? "s" : ""}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] italic text-muted-foreground/70">
                          No assignees selected
                        </span>
                      )}

                      {draft.deadline && (
                        <div className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-foreground">
                          <Clock className="size-3 text-muted-foreground" />
                          <span>
                            Due {format(new Date(draft.deadline), "MMM d, yyyy")}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3">
                    <span className="text-[11px] text-muted-foreground truncate" title={format(new Date(draft.updated_at), "PPpp")}>
                      Saved {format(new Date(draft.updated_at), "MMM d, HH:mm")}
                    </span>

                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2.5 text-xs text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 gap-1"
                        onClick={() => handleDeleteDraft(draft.id)}
                      >
                        <Trash2 className="size-3.5" />
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 px-3 text-xs font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white gap-1.5 rounded-lg shadow-2xs"
                        onClick={() => {
                          setSelectedDraft(draft);
                          setCreateModalOpen(true);
                        }}
                      >
                        <Edit3 className="size-3.5" />
                        Resume
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (

      <div className="w-full min-w-0">
        {activeView === "created" && createdRecurringSchedules.length > 0 ? (
          <div className="mb-6 space-y-3 rounded-lg border border-border p-4 w-full min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recurring Tasks You Created
              </h2>
              <span className="text-xs text-muted-foreground">
                {createdRecurringSchedules.length} total
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 w-full min-w-0">
              {createdRecurringSchedules.map((schedule) => {
                const statusLabel = !schedule.is_active
                  ? "Ended"
                  : schedule.is_paused
                    ? "Paused"
                    : "Active";
                const statusClass = !schedule.is_active
                  ? "border-border/80 bg-muted text-muted-foreground"
                  : schedule.is_paused
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
                const dotClass = !schedule.is_active
                  ? "bg-muted-foreground"
                  : schedule.is_paused
                    ? "bg-amber-500"
                    : "bg-emerald-500";

                return (
                  <Link
                    key={schedule.id}
                    href={`/tasks/recurring/${schedule.id}`}
                    className="group block w-full min-w-0"
                  >
                    <Card className="flex h-full w-full min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0d47a1]/40 hover:shadow-md hover:shadow-[#0d47a1]/5">
                      <div className="space-y-2.5 min-w-0">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight",
                              statusClass,
                            )}
                          >
                            <span className={cn("size-1.5 rounded-full", dotClass)} />
                            {statusLabel}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0d47a1] dark:text-[#38bdf8]">
                            <Repeat className="size-3" aria-hidden="true" />
                            {schedule.frequency === "daily"
                              ? `Every ${schedule.interval}d`
                              : `Every ${schedule.interval}w`}
                          </span>
                        </div>

                        <div>
                          <p className="font-semibold text-sm leading-snug break-words min-w-0 text-foreground transition-colors group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8] line-clamp-2">
                            {schedule.title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-1">
                            Next run:{" "}
                            <span className="text-foreground/80 font-medium">
                              {schedule.next_run_at
                                ? format(
                                    new Date(schedule.next_run_at),
                                    "MMM d, HH:mm",
                                  )
                                : "N/A"}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[9px] font-bold text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                            {getInitials(schedule.assigned_to?.full_name || schedule.assigned_to?.username)}
                          </div>
                          <span className="truncate text-foreground font-medium text-[11px]">
                            {schedule.assigned_to.full_name || schedule.assigned_to.username}
                          </span>
                        </div>
                        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#0d47a1]" />
                      </div>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        {isFiltering ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 w-full min-w-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <TaskCardSkeleton key={i} />
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center px-6 text-center">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                {emptyTitle}
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 w-full min-w-0">
            {tasks.map((task) => {
              const statusInfo = statusConfig[task.status] || {
                label: task.status.replace("_", " "),
                badgeClass: "border-border bg-muted text-muted-foreground",
                dotClass: "bg-muted-foreground",
              };
              const priorityInfo = priorityConfig[task.priority] || {
                label: task.priority,
                badgeClass: "border-border bg-muted text-muted-foreground",
              };
              const deadlineDate = task.deadline ? new Date(task.deadline) : null;
              const isOverdue =
                deadlineDate &&
                isPast(deadlineDate) &&
                task.status !== "completed";

              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="group block w-full min-w-0"
                >
                  <Card className="flex h-full w-full min-w-0 flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0d47a1]/40 hover:shadow-md hover:shadow-[#0d47a1]/5">
                    {/* Top metadata row: Status + Priority */}
                    <div className="min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight",
                            statusInfo.badgeClass,
                          )}
                        >
                          <span
                            className={cn("size-1.5 rounded-full", statusInfo.dotClass)}
                          />
                          {statusInfo.label}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {task.recurrence_schedule && (
                            <span
                              title="Recurring task"
                              className="inline-flex size-5 items-center justify-center rounded-md border border-[#0d47a1]/20 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]"
                            >
                              <Repeat className="size-3" aria-hidden="true" />
                            </span>
                          )}
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize",
                              priorityInfo.badgeClass,
                            )}
                          >
                            {priorityInfo.label}
                          </span>
                        </div>
                      </div>

                      {/* Task Title & Description */}
                      <div className="space-y-1.5">
                        <h3 className="text-sm sm:text-base font-semibold leading-snug text-foreground transition-colors group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8] line-clamp-2 break-words">
                          {task.title}
                        </h3>
                        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2 break-words">
                          {task.description || "No description provided."}
                        </p>
                      </div>
                    </div>

                    {/* Bottom Card Section: Assignee + Deadline */}
                    <div className="mt-4 border-t border-border/70 pt-3.5 space-y-3">
                      {/* Assignee & Assigner Row */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[10px] font-bold text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                            {getInitials(
                              task.assigned_to?.full_name ||
                                task.assigned_to?.username,
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className="truncate text-xs font-medium text-foreground"
                              title={
                                task.assigned_to?.full_name ||
                                task.assigned_to?.username
                              }
                            >
                              {task.assigned_to?.full_name ||
                                task.assigned_to?.username}
                            </p>
                          </div>
                        </div>

                        {task.assigned_by && (
                          <span
                            className="shrink-0 text-[11px] text-muted-foreground truncate max-w-[90px]"
                            title={`Assigned by ${task.assigned_by.full_name || task.assigned_by.username}`}
                          >
                            by {task.assigned_by.full_name?.split(" ")[0] || task.assigned_by.username}
                          </span>
                        )}
                      </div>

                      {/* Deadline / Due Date & Link Arrow */}
                      <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-border/40">
                        {deadlineDate ? (
                          <div
                            className={cn(
                              "flex items-center gap-1.5 text-[11px] font-medium truncate",
                              isOverdue
                                ? "text-[#dc2626] dark:text-red-400 font-semibold"
                                : "text-muted-foreground",
                            )}
                          >
                            <Clock
                              className="size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              {isOverdue ? "Overdue: " : "Due: "}
                              {format(deadlineDate, "MMM d, HH:mm")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            No deadline
                          </span>
                        )}

                        <ArrowUpRight
                          className="size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8]"
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
            {isLoadingMore && (
              <>
                <TaskCardSkeleton />
                <TaskCardSkeleton />
              </>
            )}
          </div>
        )}
      </div>
      )}

      {activeView !== "drafts" && (
        <InfiniteScrollLoader isLoading={isLoadingMore} entityName="tasks" />
      )}

      {activeView !== "drafts" && hasNextPage && (
        <div ref={loadMoreRef} className="h-8" />
      )}

      <CreateTaskModal
        open={createModalOpen}
        onOpenChange={(open) => {
          setCreateModalOpen(open);
          if (!open) {
            setSelectedDraft(null);
          }
        }}
        onTaskCreated={() => {
          setCurrentPage(1);
          setReloadToken((value) => value + 1);
          loadDrafts();
        }}
        onDraftSaved={loadDrafts}
        initialDraft={selectedDraft}
        currentUserId={currentUserId}
      />
    </div>
  );
}
