"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  getTaskDetail,
  getTaskActivities,
  updateTaskStatus,
  addTaskComment,
  getTaskAttachmentUploadUrl,
} from "@/lib/api/tasks";
import type { Task, TaskActivity, TaskAttachment } from "@/lib/api/tasks";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { TaskDetailSkeleton } from "@/components/skeletons/tasks-skeleton";
import { extractApiErrorMessage } from "@/lib/api-errors";

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

const COMMENT_MAX_LENGTH = 200;

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

function formatStatusLabel(status: string) {
  return status
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = String(params.id);

  const [task, setTask] = useState<Task | null>(null);
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState<File[]>([]);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
          extractApiErrorMessage(err, "Failed to load task");
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
      setError(extractApiErrorMessage(err, "Failed to update task"));
    } finally {
      setUpdating(false);
    }
  };

  const handleAddComment = async () => {
    if (!task) return;

    const trimmed = comment.trim();
    if (!trimmed) {
      setCommentError("Comment cannot be empty.");
      return;
    }

    if (trimmed.length > COMMENT_MAX_LENGTH) {
      setCommentError(
        `Comment cannot exceed ${COMMENT_MAX_LENGTH} characters.`,
      );
      return;
    }

    try {
      setIsPostingComment(true);
      setCommentError(null);

      let attachmentsPayload:
        | {
            object_key: string;
            file_name: string;
            content_type: string;
            size: number;
          }[]
        | undefined;

      if (selectedAttachments.length > 0) {
        setIsUploadingAttachment(true);
        attachmentsPayload = [];
        for (const file of selectedAttachments) {
          const uploadResponse = await getTaskAttachmentUploadUrl(taskId, {
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
            size: file.size,
          });

          const uploadResult = await fetch(uploadResponse.upload_url, {
            method: "PUT",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          });

          if (!uploadResult.ok) {
            throw new Error(`Failed to upload attachment ${file.name}`);
          }

          attachmentsPayload.push({
            object_key: uploadResponse.object_key,
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
            size: file.size,
          });
        }
      }

      await addTaskComment(taskId, trimmed, attachmentsPayload);
      setComment("");
      setSelectedAttachments([]);
      const newActivities = await getTaskActivities(taskId);
      setActivities(newActivities);
      toast.success("Comment posted successfully.");
    } catch (err) {
      const message =
        extractApiErrorMessage(err, "Failed to add comment");
      toast.error(message);
      setCommentError(message);
    } finally {
      setIsUploadingAttachment(false);
      setIsPostingComment(false);
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
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Back to Tasks
          </Button>
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
  const canComment =
    currentUserId === task.assigned_to.id ||
    currentUserId === task.assigned_by.id;
  const hasCompletedTimelineItem = Boolean(task.completed_at);

  return (
    <div className="space-y-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tasks
      </Button>

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
      <div className="grid gap-4 lg:grid-cols-3">
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
            {task.recurrence_schedule ? (
              <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">Recurring schedule</p>
                <p className="mt-1">
                  This task is created from a recurring schedule.
                </p>
                {task.recurrence_scheduled_for ? (
                  <p className="mt-1 text-xs text-blue-700">
                    Scheduled for{" "}
                    {format(
                      new Date(task.recurrence_scheduled_for),
                      "MMM dd, yyyy HH:mm",
                    )}
                  </p>
                ) : null}
                <Link
                  href={`/tasks/recurring/${task.recurrence_schedule}`}
                  className="mt-2 inline-block text-xs font-semibold text-blue-700 hover:text-blue-800"
                >
                  View recurring task details
                </Link>
              </div>
            ) : null}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

        <Card className="p-6">
          <h3 className="font-semibold mb-4">Add Comment</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <textarea
                value={comment}
                onChange={(event) => {
                  setComment(event.target.value);
                  if (commentError) setCommentError(null);
                }}
                placeholder="Write a comment for this task..."
                disabled={!canComment || isPostingComment}
                maxLength={COMMENT_MAX_LENGTH}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                disabled={!canComment || isPostingComment}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  const maxFiles = 10;
                  // Append newly selected files to existing selection
                  const combined = [...selectedAttachments, ...files];
                  if (combined.length > maxFiles) {
                    setSelectedAttachments(combined.slice(0, maxFiles));
                    toast.error(
                      `Maximum ${maxFiles} files allowed; extra files were ignored.`,
                    );
                  } else {
                    setSelectedAttachments(combined);
                  }
                  // Reset the native input so selecting the same file again will fire onChange
                  // and so users can add files in multiple clicks.
                  try {
                    // Clear the value in a safe way
                    event.target.value = "";
                  } catch {
                    /* ignore */
                  }
                  if (commentError) setCommentError(null);
                }}
                className="hidden"
              />
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!canComment || isPostingComment}
                >
                  Attach File(s)
                </Button>

                {selectedAttachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedAttachments.map((file, idx) => (
                      <div
                        key={`${file.name}-${file.size}-${idx}`}
                        className="flex items-center justify-between rounded-md border border-dashed px-3 py-2 text-sm text-gray-700"
                      >
                        <div>
                          <p className="font-medium">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setSelectedAttachments(
                              selectedAttachments.filter((_, i) => i !== idx),
                            )
                          }
                          disabled={isPostingComment}
                          className="text-red-600 hover:bg-red-600 hover:text-white"
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 text-right">
              {comment.length}/{COMMENT_MAX_LENGTH}
            </p>
            {commentError && (
              <p className="text-sm text-red-600">{commentError}</p>
            )}
            {!canComment && (
              <p className="text-sm text-gray-600">
                Only the assigner and assignee can add comments.
              </p>
            )}
            <Button
              type="button"
              onClick={handleAddComment}
              disabled={
                !canComment || isPostingComment || isUploadingAttachment
              }
              className="w-full"
            >
              {(isPostingComment || isUploadingAttachment) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {isUploadingAttachment ? "Uploading..." : "Post Comment"}
            </Button>
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
                      {activity.attachments.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {activity.attachments.map((attachment) => (
                            <AttachmentLink
                              key={attachment.id}
                              attachment={attachment}
                            />
                          ))}
                        </div>
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

function AttachmentLink({ attachment }: { attachment: TaskAttachment }) {
  return (
    <div className="flex w-40 flex-col items-center text-center sm:w-44">
      <div className="flex w-full items-center justify-center">
        <Image
          src="/file.png"
          loading="eager"
          alt=""
          width={100}
          height={100}
          className="h-18 w-18"
        />
      </div>

      <p className="mt-3 w-full break-words text-sm font-medium leading-5 text-foreground">
        {attachment.file_name}
      </p>

      <p className="mt-1 text-xs text-muted-foreground">
        {(attachment.size / 1024).toFixed(1)} KB
      </p>

      <div className="mt-3 flex items-center justify-center gap-2">
        {attachment.download_url ? (
          <a
            href={attachment.download_url}
            download={attachment.file_name}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-blue-100 hover:text-blue-700"
            aria-label={`Download ${attachment.file_name}`}
            title="Download"
          >
            <Download className="h-5 w-5" />
          </a>
        ) : null}
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
