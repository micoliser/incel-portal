"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Loader2, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { getTasks } from "@/lib/api/tasks";
import type { Task } from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { TasksSkeleton } from "@/components/skeletons/tasks-skeleton";
import { CreateTaskModal } from "@/components/create-task-modal";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
};

const priorityColors: Record<string, string> = {
  low: "text-gray-500",
  medium: "text-orange-500",
  high: "text-red-500",
};

const statusFilterOptions: Array<{ value: Task["status"]; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
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
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeView, setActiveView] = useState<"assigned" | "created">(
    "assigned",
  );
  const [selectedStatuses, setSelectedStatuses] = useState<Task["status"][]>(
    [],
  );
  const [selectedPriorities, setSelectedPriorities] = useState<
    Task["priority"][]
  >([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isRequestInFlightRef = useRef(false);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const profileResponse = await apiClient.get("/me");
        setCurrentUserId(profileResponse.data.id ?? null);
      } catch {
        setCurrentUserId(null);
      }
    };

    fetchProfile();
  }, []);

  useEffect(() => {
    setTasks([]);
    setCurrentPage(1);
    setHasNextPage(false);
  }, [activeView, selectedStatuses, selectedPriorities, reloadToken]);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        isRequestInFlightRef.current = true;
        if (currentPage === 1) {
          setLoading(true);
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
          err instanceof Error ? err.message : "Failed to load tasks";
        toast.error(message);
        if (currentPage === 1) {
          setLoadError(message);
        }
      } finally {
        isRequestInFlightRef.current = false;
        setLoading(false);
        setIsLoadingMore(false);
      }
    };

    loadTasks();
  }, [activeView, currentPage, selectedPriorities, selectedStatuses]);

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
  const emptyMessage =
    tasks.length === 0 && hasActiveFilters
      ? "No tasks match the selected filters"
      : activeView === "assigned"
        ? "No tasks assigned to you"
        : "No tasks created by you";

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

  if (loading) {
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
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1 dark:border-slate-700 dark:bg-slate-900/60">
          <Button
            type="button"
            variant={activeView === "assigned" ? "default" : "ghost"}
            className="rounded-md"
            onClick={() => {
              setActiveView("assigned");
            }}
          >
            Assigned to Me
          </Button>
          <Button
            type="button"
            variant={activeView === "created" ? "default" : "ghost"}
            className="rounded-md"
            onClick={() => {
              setActiveView("created");
            }}
          >
            Created by Me
          </Button>
        </div>

        <Button onClick={() => setCreateModalOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Create Task
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-red-800">{error}</div>
        </div>
      )}

      <div className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">Status</span>
          {statusFilterOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={
                selectedStatuses.includes(option.value) ? "default" : "outline"
              }
              onClick={() => toggleStatusFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">Priority</span>
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
              onClick={() => {
                setSelectedStatuses([]);
                setSelectedPriorities([]);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      <div>
        {tasks.length === 0 ? (
          <div className="flex min-h-[40vh] items-center justify-center px-6 text-center">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                {tasks.length === 0 && hasActiveFilters
                  ? "No Matching Tasks"
                  : activeView === "assigned"
                    ? "No Assigned Tasks"
                    : "No Created Tasks"}
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground">
                {emptyMessage}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {tasks.map((task) => (
              <Link key={task.id} href={`/tasks/${task.id}`}>
                <Card className="h-full cursor-pointer p-6 hover:shadow-lg transition-shadow">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <h3 className="font-semibold text-lg leading-tight">
                        {task.title}
                      </h3>
                      <span
                        className={`whitespace-nowrap rounded px-2 py-1 text-xs font-semibold ${statusColors[task.status]}`}
                      >
                        {task.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      {task.description.substring(0, 100)}...
                    </p>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-gray-700 dark:text-gray-300">
                        {activeView === "assigned" ? "By" : "To"}{" "}
                        <span className="font-medium">
                          {activeView === "assigned"
                            ? task.assigned_by.full_name
                            : task.assigned_to.full_name}
                        </span>
                      </div>
                      <div
                        className={`font-semibold ${priorityColors[task.priority]}`}
                      >
                        {task.priority}
                      </div>
                    </div>
                    {task.deadline && (
                      <div className="text-xs text-gray-600 dark:text-gray-300">
                        Due:{" "}
                        {format(new Date(task.deadline), "MMM dd, yyyy HH:mm")}
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        {isLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
      </div>

      {hasNextPage && <div ref={loadMoreRef} className="h-8" />}

      <CreateTaskModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onTaskCreated={() => setReloadToken((value) => value + 1)}
        currentUserId={currentUserId}
      />
    </div>
  );
}
