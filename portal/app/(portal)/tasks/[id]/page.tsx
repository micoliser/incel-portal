"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  getTaskDetail,
  getTaskActivities,
  updateTaskStatus,
} from "@/lib/api/tasks";
import type { Task, TaskActivity } from "@/lib/api/tasks";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { TaskDetailSkeleton } from "@/components/skeletons/tasks-skeleton";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
};

const priorityIcons: Record<string, React.ReactNode> = {
  low: null,
  medium: <AlertTriangle className="h-4 w-4" />,
  high: <AlertCircle className="h-4 w-4" />,
};

const priorityColors: Record<string, string> = {
  low: "text-gray-500",
  medium: "text-orange-500",
  high: "text-red-500",
};

function formatStatusLabel(status: string) {
  return status
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [taskData, activitiesData, profileResponse] = await Promise.all([
          getTaskDetail(taskId),
          getTaskActivities(taskId),
          apiClient.get("/me"),
        ]);
        setTask(taskData);
        setActivities(activitiesData);
        setCurrentUserId(profileResponse.data.id ?? null);
        setLoadError(null);
        setError(null);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load task";
        toast.error(message);
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    };

    if (taskId) {
      fetchData();
    }
  }, [taskId]);

  const handleStatusChange = async (newStatus: string) => {
    if (!task) return;

    try {
      setUpdating(true);
      const updated = await updateTaskStatus(taskId, newStatus);
      setTask(updated);
      // Refresh activities
      const newActivities = await getTaskActivities(taskId);
      setActivities(newActivities);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update task");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <TaskDetailSkeleton />;
  }

  if (loadError || !task) {
    return (
      <PageErrorCard
        title="Failed to load task"
        message={loadError || "Task not found"}
        onRetry={() => window.location.reload()}
        actions={
          <Link href="/tasks">
            <Button type="button" variant="outline">
              Back to Tasks
            </Button>
          </Link>
        }
      />
    );
  }

  const nextStatuses = {
    pending: ["in_progress"],
    in_progress: ["completed"],
    completed: [],
  };

  const availableTransitions =
    nextStatuses[task.status as keyof typeof nextStatuses] || [];
  const canUpdateStatus = currentUserId === task.assigned_to.id;
  const hasCompletedTimelineItem = Boolean(task.completed_at);

  return (
    <div className="space-y-8">
      <Link
        href="/tasks"
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tasks
      </Link>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{task.title}</h1>
            <p className="text-gray-600 mt-2">{task.description}</p>
          </div>
          <span
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${statusColors[task.status]}`}
          >
            {task.status.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Task Details */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Task Information</h3>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600">Assigned By</p>
              <p className="font-medium">{task.assigned_by.full_name}</p>
              <p className="text-xs text-gray-500">{task.assigned_by.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Assigned To</p>
              <p className="font-medium">{task.assigned_to.full_name}</p>
              <p className="text-xs text-gray-500">{task.assigned_to.email}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Priority</p>
                <p
                  className={`font-medium capitalize flex items-center gap-2 ${priorityColors[task.priority]}`}
                >
                  {priorityIcons[task.priority]} {task.priority}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Created</p>
                <p className="font-medium text-sm">
                  {format(new Date(task.created_at), "MMM dd, yyyy HH:mm")}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Status Control */}
        <Card className="p-6">
          <h3 className="font-semibold mb-4">Status</h3>
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-4">
              {task.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              ) : task.status === "in_progress" ? (
                <Clock className="h-5 w-5 text-blue-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
              )}
              <span className="font-semibold capitalize">
                {task.status.replace("_", " ")}
              </span>
            </div>

            {task.deadline && (
              <div className="text-sm">
                <p className="text-gray-600">Deadline</p>
                <p className="font-medium">
                  {format(new Date(task.deadline), "MMM dd, yyyy HH:mm")}
                </p>
              </div>
            )}

            {task.completed_at && (
              <div className="text-sm">
                <p className="text-gray-600">Completed</p>
                <p className="font-medium">
                  {format(new Date(task.completed_at), "MMM dd, yyyy HH:mm")}
                </p>
              </div>
            )}

            {canUpdateStatus && availableTransitions.length > 0 && (
              <div className="flex gap-2 flex-wrap pt-4 border-t">
                {availableTransitions.map((status) => (
                  <Button
                    key={status}
                    onClick={() => handleStatusChange(status)}
                    disabled={updating}
                    variant="outline"
                    size="sm"
                    className="capitalize"
                  >
                    {updating && (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    )}
                    Mark as {formatStatusLabel(status)}
                  </Button>
                ))}
              </div>
            )}

            {!canUpdateStatus && (
              <p className="border-t pt-4 text-sm text-gray-600">
                Only the assignee can update task progress.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Activity Timeline */}
      <div className="space-y-6">
        <h3 className="text-center text-lg font-semibold">Activity Timeline</h3>
        {activities.length === 0 ? (
          <div className="text-center text-gray-600 py-8">No activity yet</div>
        ) : (
          <div className="mx-auto max-w-3xl py-2">
            <div>
              {hasCompletedTimelineItem && (
                <div className="relative mx-auto flex w-full max-w-2xl gap-4 pb-8">
                  <div className="relative flex w-8 justify-center">
                    <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-slate-950">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>

                    {activities.length > 0 && (
                      <div className="absolute bottom-[-1.75rem] left-1/2 top-7 w-[6px] -translate-x-1/2 bg-[radial-gradient(circle,theme(colors.gray.400)_2px,transparent_2.2px)] bg-[length:6px_14px] bg-repeat-y" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-green-700 dark:text-green-400">
                        Task Completed
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {format(
                        new Date(task.completed_at as string),
                        "MMM dd, yyyy HH:mm",
                      )}
                    </p>
                  </div>
                </div>
              )}

              {activities.map((activity, index) => {
                const isLast = index === activities.length - 1;

                return (
                  <div
                    key={activity.id}
                    className="relative mx-auto flex w-full max-w-2xl gap-4 pb-8 last:pb-0"
                  >
                    <div className="relative flex w-8 justify-center">
                      <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-slate-950">
                        {activity.activity_type === "status_change" ? (
                          <CheckCircle2 className="h-5 w-5 text-blue-600" />
                        ) : activity.activity_type === "created" ? (
                          <IconPlus className="h-5 w-5 text-gray-600" />
                        ) : (
                          <Clock className="h-5 w-5 text-gray-600" />
                        )}
                      </div>

                      {!isLast && (
                        <div className="absolute bottom-[-1.75rem] left-1/2 top-7 w-[6px] -translate-x-1/2 bg-[radial-gradient(circle,theme(colors.gray.400)_2px,transparent_2.2px)] bg-[length:6px_14px] bg-repeat-y" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{activity.user.full_name}</p>
                        <p className="text-sm text-gray-600 capitalize">
                          {activity.activity_type.replace("_", " ")}
                        </p>
                      </div>
                      {activity.activity_type === "status_change" && (
                        <p className="mt-1 text-sm text-gray-600">
                          Changed from{" "}
                          <span className="font-medium capitalize">
                            {activity.old_value}
                          </span>{" "}
                          to{" "}
                          <span className="font-medium capitalize">
                            {activity.new_value}
                          </span>
                        </p>
                      )}
                      {activity.comment && (
                        <p className="mt-1 text-sm italic text-gray-700">
                          {activity.comment}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        {format(
                          new Date(activity.created_at),
                          "MMM dd, yyyy HH:mm",
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IconPlus({ className }: { className: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 4v16m8-8H4"
      />
    </svg>
  );
}
