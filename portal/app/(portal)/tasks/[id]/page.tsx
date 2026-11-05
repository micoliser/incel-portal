"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format, isPast } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Download,
  Pencil,
  Check,
  XCircle,
  Shield,
  Link2,
  ExternalLink,
  X,
  FileText,
  Calendar,
  Repeat,
  Send,
  Paperclip,
  MessageSquare,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  getTaskDetail,
  getTaskActivities,
  updateTaskStatus,
  addTaskComment,
  getTaskAttachmentUploadUrl,
  approveTask,
} from "@/lib/api/tasks";
import type { Task, TaskActivity, TaskAttachment } from "@/lib/api/tasks";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { TaskDetailSkeleton } from "@/components/skeletons/tasks-skeleton";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { processAndValidateFile } from "@/lib/file-utils";
import { EditTaskModal } from "@/components/edit-task-modal";
import { RejectTaskModal } from "@/components/reject-task-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function getInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const statusConfig: Record<
  string,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  pending: {
    label: "Pending",
    badgeClass: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    dotClass: "bg-amber-500",
    description: "Task is pending and waiting to be started.",
  },
  in_progress: {
    label: "In Progress",
    badgeClass: "border-[#0d47a1]/25 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]",
    dotClass: "bg-[#0d47a1] dark:bg-[#38bdf8]",
    description: "Work is actively in progress by the assignee.",
  },
  under_review: {
    label: "Under Review",
    badgeClass: "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    dotClass: "bg-purple-500",
    description: "Submitted for approval. Awaiting review from assigner.",
  },
  completed: {
    label: "Completed",
    badgeClass: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
    description: "All requirements met and finalized.",
  },
};

const priorityConfig: Record<
  string,
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

const priorityIcons: Record<string, React.ReactNode> = {
  low: null,
  medium: <AlertTriangle className="h-4 w-4" />,
  high: <AlertCircle className="h-4 w-4" />,
};

const COMMENT_MAX_LENGTH = 500;

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

  const [attachedLinks, setAttachedLinks] = useState<{ url: string; title: string }[]>([]);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const handleAddLink = () => {
    let url = linkUrl.trim();
    if (!url) {
      setLinkError("URL is required.");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }
    try {
      new URL(url);
    } catch {
      setLinkError("Please enter a valid URL.");
      return;
    }
    const title = linkTitle.trim() || url;
    setAttachedLinks((prev) => [...prev, { url, title }]);
    setLinkUrl("");
    setLinkTitle("");
    setLinkError(null);
    setIsAddingLink(false);
  };

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [approveConfirmOpen, setApproveConfirmOpen] = useState(false);

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

  const handleApprove = async () => {
    if (!task) return;
    try {
      setIsApproving(true);
      const updated = await approveTask(taskId);
      setTask(updated);
      const newActivities = await getTaskActivities(taskId);
      setActivities(newActivities);
      toast.success("Task approved and marked as completed.");
      setError(null);
    } catch (err) {
      const msg = extractApiErrorMessage(err, "Failed to approve task");
      toast.error(msg);
      setError(msg);
    } finally {
      setIsApproving(false);
    }
  };

  const handleTaskRejected = async (updatedTask: Task) => {
    setTask(updatedTask);
    const newActivities = await getTaskActivities(taskId);
    setActivities(newActivities);
    setError(null);
  };

  const handleTaskUpdated = async (updatedTask: Task) => {
    setTask(updatedTask);
    const newActivities = await getTaskActivities(taskId);
    setActivities(newActivities);
    setError(null);
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
          const processedFile = await processAndValidateFile(file);
          const uploadResponse = await getTaskAttachmentUploadUrl(taskId, {
            file_name: processedFile.name,
            content_type: processedFile.type || "application/octet-stream",
            size: processedFile.size,
          });

          const uploadResult = await fetch(uploadResponse.upload_url, {
            method: "PUT",
            headers: {
              "Content-Type": processedFile.type || "application/octet-stream",
            },
            body: processedFile,
          });

          if (!uploadResult.ok) {
            throw new Error(`Failed to upload attachment ${file.name}`);
          }

          attachmentsPayload.push({
            object_key: uploadResponse.object_key,
            file_name: processedFile.name,
            content_type: processedFile.type || "application/octet-stream",
            size: processedFile.size,
          });
        }
      }

      await addTaskComment(
        taskId,
        trimmed,
        attachmentsPayload,
        attachedLinks.length > 0 ? attachedLinks : undefined,
      );
      setComment("");
      setSelectedAttachments([]);
      setAttachedLinks([]);
      setIsAddingLink(false);
      setLinkUrl("");
      setLinkTitle("");
      setLinkError(null);
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

  const isAssigner = currentUserId === task.assigned_by.id;
  const isAssignee = currentUserId === task.assigned_to.id;
  const canComment = true;
  const hasCompletedTimelineItem = Boolean(task.completed_at);
  const statusInfo = statusConfig[task.status] || {
    label: formatStatusLabel(task.status),
    badgeClass: "border-border bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
    description: "Current task status.",
  };
  const priorityInfo = priorityConfig[task.priority] || {
    label: task.priority,
    badgeClass: "border-border bg-muted text-muted-foreground",
  };
  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
  const isOverdue =
    deadlineDate && isPast(deadlineDate) && task.status !== "completed";

  return (
    <div className="space-y-6">
      {/* Top Bar: Back button and Edit action */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="group inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs sm:text-sm font-medium text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          Back to Tasks
        </Button>

        <div className="flex items-center gap-2.5">
          {isAssigner && task.status !== "completed" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditModalOpen(true)}
              className="flex items-center gap-1.5 text-xs sm:text-sm"
            >
              <Pencil className="size-3.5" />
              Edit Task
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 p-4 flex items-center gap-3 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="size-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left / Main Column: Task Details + Activity Stream (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Main Task Header Card */}
          <Card className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-5">
            {/* Metadata Tags Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/70 pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-tight",
                    statusInfo.badgeClass,
                  )}
                >
                  <span className={cn("size-2 rounded-full", statusInfo.dotClass)} />
                  {statusInfo.label}
                </span>

                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium capitalize",
                    priorityInfo.badgeClass,
                  )}
                >
                  {priorityIcons[task.priority]}
                  {priorityInfo.label} Priority
                </span>

                {task.recurrence_schedule && (
                  <Link
                    href={`/tasks/recurring/${task.recurrence_schedule}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#0d47a1]/25 bg-[#0d47a1]/10 px-2.5 py-1 text-xs font-medium text-[#0d47a1] dark:text-[#38bdf8] transition-colors hover:bg-[#0d47a1]/20"
                  >
                    <Repeat className="size-3.5" />
                    Recurring Task
                  </Link>
                )}
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Calendar className="size-3.5" />
                Created {format(new Date(task.created_at), "MMM d, yyyy")}
              </div>
            </div>

            {/* Task Title */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-snug">
                {task.title}
              </h1>
            </div>

            {/* Description Section */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Description
              </h3>
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4 sm:p-5 text-sm sm:text-base leading-relaxed text-foreground whitespace-pre-wrap">
                {task.description ? (
                  task.description
                ) : (
                  <span className="italic text-muted-foreground text-sm">
                    No description provided for this task.
                  </span>
                )}
              </div>
            </div>

            {/* Recurrence Banner if created from recurring schedule */}
            {task.recurrence_schedule ? (
              <div className="rounded-xl border border-border/80 bg-[#0d47a1]/5 p-4 text-xs sm:text-sm text-foreground space-y-1.5 dark:bg-[#0d47a1]/10">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#0d47a1] dark:text-[#38bdf8] flex items-center gap-1.5">
                    <Repeat className="size-4" /> Recurring Schedule Source
                  </span>
                  <Link
                    href={`/tasks/recurring/${task.recurrence_schedule}`}
                    className="font-medium text-[#0d47a1] dark:text-[#38bdf8] hover:underline flex items-center gap-1"
                  >
                    View schedule details
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
                {task.recurrence_scheduled_for ? (
                  <p className="text-muted-foreground text-xs">
                    Scheduled execution timestamp:{" "}
                    <span className="font-medium text-foreground">
                      {format(new Date(task.recurrence_scheduled_for), "MMM dd, yyyy HH:mm")}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </Card>

          {/* Activity & Collaboration Hub */}
          <Card className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-border/70 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                  <MessageSquare className="size-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground">
                    Activity & Discussion
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Collaboration updates, attachments, and status timeline
                  </p>
                </div>
              </div>

              <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {activities.length} update{activities.length === 1 ? "" : "s"}
              </span>
            </div>

            {/* Inline Comment Composer */}
            <div className="rounded-xl border border-border/80 bg-muted/20 p-4 space-y-3.5">
              <div className="flex items-start gap-3">
                <div className="hidden sm:flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-xs font-bold text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]">
                  Me
                </div>
                <div className="flex-1 space-y-2.5 min-w-0">
                  <textarea
                    value={comment}
                    onChange={(event) => {
                      setComment(event.target.value);
                      if (commentError) setCommentError(null);
                    }}
                    placeholder="Share an update, notes, or feedback on this task..."
                    disabled={!canComment || isPostingComment}
                    maxLength={COMMENT_MAX_LENGTH}
                    rows={3}
                    className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-sm shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0d47a1] disabled:cursor-not-allowed disabled:opacity-60 placeholder:text-muted-foreground/70"
                  />

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    disabled={!canComment || isPostingComment}
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      const maxFiles = 10;
                      const combined = [...selectedAttachments, ...files];
                      if (combined.length > maxFiles) {
                        setSelectedAttachments(combined.slice(0, maxFiles));
                        toast.error(`Maximum ${maxFiles} files allowed.`);
                      } else {
                        setSelectedAttachments(combined);
                      }
                      try {
                        event.target.value = "";
                      } catch {
                        /* ignore */
                      }
                      if (commentError) setCommentError(null);
                    }}
                    className="hidden"
                  />

                  {/* Add link form popdown */}
                  {isAddingLink && (
                    <div className="rounded-lg border border-border bg-card p-3 space-y-2.5 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Link2 className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" /> Attach Link
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setIsAddingLink(false);
                            setLinkUrl("");
                            setLinkTitle("");
                            setLinkError(null);
                          }}
                          className="text-muted-foreground hover:text-foreground text-xs"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          placeholder="https://drive.google.com/... or URL"
                          value={linkUrl}
                          onChange={(e) => {
                            setLinkUrl(e.target.value);
                            if (linkError) setLinkError(null);
                          }}
                          className="text-xs h-8"
                          autoFocus
                        />
                        <Input
                          placeholder="Link title (e.g. Design Spec)"
                          value={linkTitle}
                          onChange={(e) => setLinkTitle(e.target.value)}
                          className="text-xs h-8"
                        />
                      </div>
                      {linkError && <p className="text-xs text-destructive">{linkError}</p>}
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2.5"
                          onClick={() => {
                            setIsAddingLink(false);
                            setLinkUrl("");
                            setLinkTitle("");
                            setLinkError(null);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 text-xs px-3 bg-[#0d47a1] hover:bg-[#0a3880] text-white"
                          onClick={handleAddLink}
                        >
                          Add Link
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Attached links chips */}
                  {attachedLinks.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {attachedLinks.map((item, idx) => (
                        <div
                          key={`${item.url}-${idx}`}
                          className="inline-flex items-center gap-1.5 rounded-md border border-[#0d47a1]/20 bg-[#0d47a1]/10 px-2.5 py-1 text-xs text-[#0d47a1] dark:text-[#38bdf8]"
                        >
                          <Link2 className="size-3.5 shrink-0" />
                          <span className="max-w-[180px] truncate font-medium" title={item.url}>
                            {item.title}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setAttachedLinks((prev) =>
                                prev.filter((_, i) => i !== idx),
                              )
                            }
                            className="text-muted-foreground hover:text-destructive ml-0.5"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Selected attachments chips */}
                  {selectedAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedAttachments.map((file, idx) => (
                        <div
                          key={`${file.name}-${file.size}-${idx}`}
                          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground"
                        >
                          <Paperclip className="size-3.5 text-muted-foreground" />
                          <span className="max-w-[180px] truncate font-medium">
                            {file.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({(file.size / 1024).toFixed(0)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedAttachments(
                                selectedAttachments.filter((_, i) => i !== idx),
                              )
                            }
                            disabled={isPostingComment}
                            className="text-muted-foreground hover:text-destructive ml-0.5"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {commentError && (
                    <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                      {commentError}
                    </p>
                  )}

                  {/* Bottom composer toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canComment || isPostingComment}
                        className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Paperclip className="size-3.5" />
                        Attach Files
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddingLink((prev) => !prev)}
                        disabled={!canComment || isPostingComment}
                        className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Link2 className="size-3.5" />
                        Attach Link
                      </Button>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {comment.length}/{COMMENT_MAX_LENGTH}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddComment}
                        disabled={
                          !canComment ||
                          isPostingComment ||
                          isUploadingAttachment ||
                          (!comment.trim() &&
                            selectedAttachments.length === 0 &&
                            attachedLinks.length === 0)
                        }
                        className="h-8 px-3.5 text-xs font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white"
                      >
                        {isPostingComment || isUploadingAttachment ? (
                          <>
                            <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                            {isUploadingAttachment ? "Uploading..." : "Posting..."}
                          </>
                        ) : (
                          <>
                            <Send className="size-3.5 mr-1.5" />
                            Post Comment
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Timeline Stream */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Timeline History
              </h3>

              {activities.length === 0 && !hasCompletedTimelineItem ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No activity recorded for this task yet.
                </div>
              ) : (
                <div className="relative pl-6 space-y-6 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-border/80">
                  {/* If task is completed, render completion header node */}
                  {hasCompletedTimelineItem && (
                    <div className="relative flex items-start gap-3">
                      <div className="absolute -left-6 flex size-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-4 ring-background dark:text-emerald-400">
                        <CheckCircle2 className="size-4" />
                      </div>
                      <div className="flex-1 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3.5 text-xs text-emerald-800 dark:text-emerald-300">
                        <p className="font-semibold text-sm">
                          Task Completed & Finalized
                        </p>
                        <p className="mt-0.5 text-emerald-700/80 dark:text-emerald-400/80">
                          {format(
                            new Date(task.completed_at as string),
                            "EEEE, MMMM d, yyyy · HH:mm",
                          )}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Render activities */}
                  {activities.map((activity) => {
                    const isComment = activity.activity_type === "comment";

                    if (isComment) {
                      return (
                        <div key={activity.id} className="relative flex items-start gap-3">
                          <div className="absolute -left-6 flex size-6 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[#0d47a1] ring-4 ring-background dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]">
                            <MessageSquare className="size-3.5" />
                          </div>
                          <div className="flex-1 rounded-xl border border-border bg-card p-4 shadow-2xs space-y-3">
                            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
                              <div className="flex items-center gap-2">
                                <div className="flex size-6 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[10px] font-bold text-[#0d47a1] dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]">
                                  {getInitials(activity.user.full_name)}
                                </div>
                                <span className="font-semibold text-xs sm:text-sm text-foreground">
                                  {activity.user.full_name}
                                </span>
                              </div>
                              <span className="text-[11px] text-muted-foreground">
                                {format(new Date(activity.created_at), "MMM d, yyyy · HH:mm")}
                              </span>
                            </div>

                            {activity.comment && (
                              <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                                {activity.comment}
                              </p>
                            )}

                            {/* Attached Links */}
                            {activity.links && activity.links.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {activity.links.map((linkItem, idx) => (
                                  <a
                                    key={`${linkItem.url}-${idx}`}
                                    href={linkItem.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                                  >
                                    <ExternalLink className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" />
                                    <span className="max-w-[220px] truncate" title={linkItem.url}>
                                      {linkItem.title || linkItem.url}
                                    </span>
                                  </a>
                                ))}
                              </div>
                            )}

                            {/* Attached Files */}
                            {activity.attachments && activity.attachments.length > 0 && (
                              <div className="flex flex-wrap gap-2.5 pt-1">
                                {activity.attachments.map((attachment) => (
                                  <AttachmentCard key={attachment.id} attachment={attachment} />
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // System event (status change, created, edited)
                    const isStatusChange = activity.activity_type === "status_change";
                    const isEdited = activity.activity_type === "task_edited";

                    return (
                      <div key={activity.id} className="relative flex items-center gap-3">
                        <div className="absolute -left-6 flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-4 ring-background">
                          {isStatusChange ? (
                            <CheckCircle2 className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" />
                          ) : isEdited ? (
                            <Pencil className="size-3 text-amber-600" />
                          ) : (
                            <Plus className="size-3.5 text-muted-foreground" />
                          )}
                        </div>

                        <div className="flex-1 rounded-lg border border-border/70 bg-muted/30 px-3.5 py-2 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-foreground">
                              {activity.user.full_name}
                            </span>
                            {isStatusChange ? (
                              <span>
                                changed status from{" "}
                                <span className="font-medium text-foreground capitalize">
                                  {activity.old_value?.replace("_", " ")}
                                </span>{" "}
                                to{" "}
                                <span className="font-semibold text-[#0d47a1] dark:text-[#38bdf8] capitalize">
                                  {activity.new_value?.replace("_", " ")}
                                </span>
                              </span>
                            ) : isEdited ? (
                              <span>updated task details</span>
                            ) : (
                              <span>created this task</span>
                            )}
                          </div>

                          <span className="text-[11px] text-muted-foreground">
                            {format(new Date(activity.created_at), "MMM d, HH:mm")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right / Inspector Sidebar (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          {/* Status & Actions Inspector Card */}
          <Card className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <h3 className="font-bold text-sm text-foreground">
                Task Status & Actions
              </h3>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                  statusInfo.badgeClass,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusInfo.dotClass)} />
                {statusInfo.label}
              </span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {statusInfo.description}
            </p>

            {/* Contextual Actions */}
            {isAssignee && task.status !== "completed" && task.status !== "under_review" && (
              <div className="pt-2 border-t border-border/60 space-y-2">
                {task.status === "pending" && (
                  <Button
                    onClick={() => handleStatusChange("in_progress")}
                    disabled={updating}
                    className="w-full bg-[#0d47a1] hover:bg-[#0a3880] text-white font-medium"
                    size="sm"
                  >
                    {updating ? (
                      <Loader2 className="size-3.5 mr-2 animate-spin" />
                    ) : (
                      <Clock className="size-3.5 mr-2" />
                    )}
                    Start Task (In Progress)
                  </Button>
                )}
                {task.status === "in_progress" && (
                  <Button
                    onClick={() => setSubmitConfirmOpen(true)}
                    disabled={updating}
                    className="w-full bg-[#0d47a1] hover:bg-[#0a3880] text-white font-medium"
                    size="sm"
                  >
                    {updating ? (
                      <Loader2 className="size-3.5 mr-2 animate-spin" />
                    ) : (
                      <Check className="size-3.5 mr-2" />
                    )}
                    Submit for Approval
                  </Button>
                )}
              </div>
            )}

            {/* Under Review Notice for Assignee */}
            {isAssignee && task.status === "under_review" && (
              <div className="rounded-xl border border-purple-500/25 bg-purple-500/10 p-3.5 text-xs text-purple-800 dark:text-purple-300 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Clock className="size-3.5" /> Awaiting Review
                </p>
                <p className="text-purple-700 dark:text-purple-400">
                  You submitted this task for review. {task.assigned_by.full_name} will approve or request changes.
                </p>
              </div>
            )}

            {/* Review & Approval Actions for Assigner */}
            {isAssigner && task.status === "under_review" && (
              <div className="pt-3 border-t border-border/60 space-y-3">
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  <p className="font-semibold">Review Submission</p>
                  <p className="mt-0.5 text-amber-700/90 dark:text-amber-400">
                    {task.assigned_to.full_name} has submitted this task for your final review.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => setApproveConfirmOpen(true)}
                    disabled={isApproving}
                    className="flex-1 bg-[#16a34a] hover:bg-[#15803d] text-white font-semibold"
                  >
                    {isApproving ? (
                      <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Check className="size-3.5 mr-1.5" />
                    )}
                    Approve
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsRejectModalOpen(true)}
                    disabled={isApproving}
                    className="flex-1 border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
                  >
                    <XCircle className="size-3.5 mr-1.5" />
                    Request Changes
                  </Button>
                </div>
              </div>
            )}

            {/* Oversight notice for third-party managers */}
            {!isAssignee && !isAssigner && (
              <div className="rounded-xl border border-[#0d47a1]/25 bg-[#0d47a1]/10 p-3.5 text-xs text-[#0d47a1] dark:text-[#38bdf8] space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Shield className="size-3.5" /> Managerial Oversight
                </p>
                <p className="text-muted-foreground">
                  You are viewing this task with organizational oversight. You may post feedback and review the timeline.
                </p>
              </div>
            )}
          </Card>

          {/* Assignment & People Card */}
          <Card className="rounded-xl border border-border bg-card p-5 shadow-xs space-y-4">
            <h3 className="font-bold text-sm text-foreground border-b border-border/70 pb-3">
              Assignment & People
            </h3>

            <div className="space-y-4">
              {/* Assignee */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Assignee
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-xs font-bold text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]">
                    {getInitials(task.assigned_to.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs text-foreground truncate">
                      {task.assigned_to.full_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {task.assigned_to.email}
                    </p>
                  </div>
                </div>
              </div>

              {/* Assigner */}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Assigner
                </p>
                <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground ring-1 ring-border">
                    {getInitials(task.assigned_by.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs text-foreground truncate">
                      {task.assigned_by.full_name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {task.assigned_by.email}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Dates & Schedule */}
            <div className="space-y-3 pt-3 border-t border-border/70">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Dates & Deadlines
              </h4>

              <div className="space-y-2 text-xs">
                {task.deadline && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Clock className="size-3.5" /> Deadline:
                    </span>
                    <span
                      className={cn(
                        "font-medium",
                        isOverdue
                          ? "text-red-600 dark:text-red-400 font-semibold"
                          : "text-foreground",
                      )}
                    >
                      {format(new Date(task.deadline), "MMM dd, yyyy HH:mm")}
                      {isOverdue && " (Overdue)"}
                    </span>
                  </div>
                )}

                {task.completed_at && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 text-[#16a34a]" /> Completed:
                    </span>
                    <span className="font-medium text-foreground">
                      {format(new Date(task.completed_at), "MMM dd, yyyy HH:mm")}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="size-3.5" /> Created:
                  </span>
                  <span className="font-medium text-foreground">
                    {format(new Date(task.created_at), "MMM dd, yyyy HH:mm")}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {task && (
        <>
          <EditTaskModal
            isOpen={isEditModalOpen}
            onClose={() => setIsEditModalOpen(false)}
            task={task}
            onTaskUpdated={handleTaskUpdated}
          />
          <RejectTaskModal
            isOpen={isRejectModalOpen}
            onClose={() => setIsRejectModalOpen(false)}
            task={task}
            onTaskRejected={handleTaskRejected}
          />

          {/* Submit for Approval Confirmation Dialog */}
          <Dialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader icon={<Check className="size-4.5" />}>
                <DialogTitle>Submit Task for Approval</DialogTitle>
                <DialogDescription>
                  Are you sure you want to submit <strong>{task.title}</strong> for review? Your assigner ({task.assigned_by.full_name}) will review your work to finalize or request revisions.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="sm:justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSubmitConfirmOpen(false)}
                  disabled={updating}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
                  onClick={async () => {
                    setSubmitConfirmOpen(false);
                    await handleStatusChange("under_review");
                  }}
                  disabled={updating}
                >
                  {updating ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit for Approval"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Approve Confirmation Dialog */}
          <Dialog open={approveConfirmOpen} onOpenChange={setApproveConfirmOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader
                icon={<CheckCircle2 className="size-4.5" />}
                iconClassName="bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:bg-emerald-500/20 dark:text-emerald-400"
              >
                <DialogTitle>Approve Task Completion</DialogTitle>
                <DialogDescription>
                  Are you sure you want to approve and finalize <strong>{task.title}</strong>? This will mark the task as <strong>Completed</strong> and notify {task.assigned_to.full_name}.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="sm:justify-end gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setApproveConfirmOpen(false)}
                  disabled={isApproving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-[#16a34a] hover:bg-[#15803d] text-white"
                  onClick={async () => {
                    setApproveConfirmOpen(false);
                    await handleApprove();
                  }}
                  disabled={isApproving}
                >
                  {isApproving ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      Approving...
                    </>
                  ) : (
                    "Confirm Approval"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: TaskAttachment }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-2.5 transition-colors hover:bg-muted/70 min-w-[200px] max-w-xs">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
          <FileText className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-xs font-medium text-foreground"
            title={attachment.file_name}
          >
            {attachment.file_name}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {(attachment.size / 1024).toFixed(1)} KB
          </p>
        </div>
      </div>
      {attachment.download_url ? (
        <a
          href={attachment.download_url}
          download={attachment.file_name}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Download attachment"
        >
          <Download className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
