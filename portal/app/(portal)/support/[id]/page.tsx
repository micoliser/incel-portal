"use client";

import { useCallback, useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Paperclip,
  Send,
  Download,
  UserPlus,
  LifeBuoy,
  Laptop,
  HelpCircle,
  Clock,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  ShieldCheck,
  RefreshCw,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { UserCombobox } from "@/components/ui/user-combobox";
import { Badge } from "@/components/ui/badge";
import { SupportDetailSkeleton } from "@/components/skeletons/support-skeleton";
import {
  type SupportRequestDetail,
  getRequest,
  addComment,
  assignRequest,
  resolveRequest,
  confirmRequest,
  reopenRequest,
  updateRequestStatus,
  getUploadUrl,
  confirmUpload,
} from "@/lib/api/support";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { processAndValidateFile } from "@/lib/file-utils";
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
      "border-[#dc2626]/30 bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/20 dark:text-red-400 font-semibold",
  },
};

function formatFullDateTime(dateStr?: string | null) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

export default function SupportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [request, setRequest] = useState<SupportRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [assignUserId, setAssignUserId] = useState<string>("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getRequest(id);
      setRequest(data);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load request."));
      router.push("/support");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleAddComment() {
    if (!commentText.trim() || !request) return;
    try {
      setSubmittingComment(true);
      const comment = await addComment(request.id, commentText.trim());
      setRequest((prev) =>
        prev ? { ...prev, comments: [...prev.comments, comment] } : prev,
      );
      setCommentText("");
      toast.success("Comment added.");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to add comment."));
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleAction(action: string) {
    if (!request) return;
    setActionLoading(action);
    try {
      let updated;
      switch (action) {
        case "resolve":
          updated = await resolveRequest(request.id);
          break;
        case "confirm":
          updated = await confirmRequest(request.id);
          break;
        case "reopen":
          updated = await reopenRequest(request.id);
          break;
        default:
          return;
      }
      setRequest(updated);
      toast.success("Request updated.");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Action failed."));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleStatusChange(status: string) {
    if (!request) return;
    setActionLoading("status");
    try {
      const updated = await updateRequestStatus(request.id, status);
      setRequest(updated);
      toast.success("Status updated.");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to update status."));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAssign() {
    if (!request || !assignUserId) return;
    setActionLoading("assign");
    try {
      const updated = await assignRequest(request.id, Number(assignUserId));
      setRequest(updated);
      toast.success("Request assigned.");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to assign."));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !request) return;

    try {
      const processedFile = await processAndValidateFile(file);
      const { upload_url } = await getUploadUrl(request.id, {
        file_name: processedFile.name,
        content_type: processedFile.type || "application/octet-stream",
        size: processedFile.size,
      });

      await fetch(upload_url, {
        method: "PUT",
        body: processedFile,
        headers: { "Content-Type": processedFile.type || "application/octet-stream" },
      });

      const url = new URL(upload_url);
      const objectKey = decodeURIComponent(url.pathname.split("/").pop() || "");

      await confirmUpload(request.id, {
        object_key: objectKey,
        file_name: processedFile.name,
        content_type: processedFile.type || "application/octet-stream",
        size: processedFile.size,
      });

      toast.success("File attached.");
      void loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to attach file."));
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <SupportDetailSkeleton />
      </div>
    );
  }

  if (!request) return null;

  const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.open;
  const priorityConfig = PRIORITY_CONFIG[request.priority] || PRIORITY_CONFIG.medium;
  const isIT = request.category === "IT_SUPPORT";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 1. Header Navigation & Title Bar */}
      <div className="flex flex-col gap-3">
        {/* Back Link */}
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/support")}
            className="gap-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground -ml-2 h-8"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back to Support Requests</span>
          </Button>
        </div>

        {/* Title & Status Badges */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                {isIT ? (
                  <Laptop className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" />
                ) : (
                  <HelpCircle className="size-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span>{isIT ? "IT Support" : "General"}</span>
              </span>

              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
                  statusConfig.badgeClass,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusConfig.dotClass)} />
                <span>{statusConfig.label}</span>
              </span>

              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium",
                  priorityConfig.badgeClass,
                )}
              >
                {priorityConfig.label} Priority
              </span>
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words">
              {request.title}
            </h1>
          </div>
        </div>
      </div>

      {/* 2. Coordinated Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column (2 spans): Description, Attachments, Comments */}
        <div className="lg:col-span-2 space-y-6">
          {/* Ticket Description Card */}
          <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <FileText className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                Description
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                {request.description}
              </p>
            </CardContent>
          </Card>

          {/* Ticket Attachments Card */}
          {request.attachments.length > 0 && (
            <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <Paperclip className="size-4 text-muted-foreground" />
                  Attachments ({request.attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <ul className="divide-y divide-border/60">
                  {request.attachments.map((att) => (
                    <li
                      key={att.id}
                      className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0 text-sm"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <Paperclip className="size-3.5" />
                        </div>
                        <span className="truncate font-medium text-foreground text-xs sm:text-sm">
                          {att.file_name}
                        </span>
                      </div>
                      {att.download_url && (
                        <a
                          href={att.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted hover:text-[#0d47a1] transition-colors"
                        >
                          <Download className="size-3" />
                          <span>Download</span>
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Discussion / Timeline Card */}
          <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Clock className="size-4 text-muted-foreground" />
                Discussion & Activity ({request.comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {request.comments.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  No comments or updates yet. Add a reply below.
                </div>
              ) : (
                request.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className={cn(
                      "rounded-xl border p-4 text-sm transition-all",
                      comment.is_system
                        ? "border-border/60 bg-muted/30"
                        : "border-border bg-card shadow-xs",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                          {comment.author.full_name?.charAt(0) || "U"}
                        </div>
                        <span className="font-semibold text-foreground">
                          {comment.author.full_name}
                        </span>
                        {comment.is_system && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase font-bold tracking-wider py-0 px-1.5 border-border bg-muted/60"
                          >
                            System Audit
                          </Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {formatFullDateTime(comment.created_at)}
                      </span>
                    </div>

                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/90 pl-8">
                      {comment.body}
                    </p>

                    {comment.attachments.length > 0 && (
                      <div className="mt-3 pl-8 flex flex-wrap gap-2">
                        {comment.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="inline-flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs text-foreground"
                          >
                            <Paperclip className="size-3 text-muted-foreground" />
                            <span className="truncate max-w-[180px] font-medium">
                              {att.file_name}
                            </span>
                            {att.download_url && (
                              <a
                                href={att.download_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1 text-[#0d47a1] dark:text-[#38bdf8] font-semibold hover:underline"
                              >
                                Download
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {/* Add Comment Box */}
              <div className="pt-4 border-t border-border/60 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Add a Reply
                </h4>
                <Textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Type your reply or status update..."
                  rows={3}
                  className="rounded-lg bg-card"
                />
                <div className="flex items-center justify-between">
                  <div>
                    <input
                      id="attach-file"
                      type="file"
                      className="hidden"
                      onChange={handleFileAttach}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => document.getElementById("attach-file")?.click()}
                      className="rounded-lg text-xs font-medium"
                    >
                      <Paperclip className="mr-1.5 size-3.5" />
                      Attach File
                    </Button>
                  </div>
                  <Button
                    onClick={handleAddComment}
                    disabled={submittingComment || !commentText.trim()}
                    className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold px-4 shadow-sm"
                  >
                    {submittingComment ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 size-3.5" />
                    )}
                    Send Reply
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Column (1 span): Ticket Metadata & Actions */}
        <div className="space-y-6">
          {/* Metadata Card */}
          <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
            <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <ShieldCheck className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                Ticket Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 space-y-4 text-xs">
              {/* Requester */}
              <div>
                <span className="text-muted-foreground">Requested by</span>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-foreground">
                    {request.requester.full_name?.charAt(0) || "U"}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">
                      {request.requester.full_name}
                    </p>
                    <p className="text-muted-foreground">{request.requester.email}</p>
                  </div>
                </div>
              </div>

              {/* Department */}
              <div className="border-t border-border/60 pt-3">
                <span className="text-muted-foreground">Department</span>
                <p className="mt-0.5 font-medium text-sm text-foreground">
                  {request.department.name}
                </p>
              </div>

              {/* Assigned Handler */}
              <div className="border-t border-border/60 pt-3">
                <span className="text-muted-foreground">Assigned Handler</span>
                {request.assigned_to ? (
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[11px] font-bold text-[#0d47a1] dark:text-[#38bdf8]">
                      {request.assigned_to.full_name?.charAt(0) || "A"}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-foreground">
                        {request.assigned_to.full_name}
                      </p>
                      <p className="text-muted-foreground">
                        {request.assigned_to.email}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 text-muted-foreground italic">
                    Unassigned
                  </p>
                )}
              </div>

              {/* Timestamps */}
              <div className="border-t border-border/60 pt-3 space-y-2">
                <div>
                  <span className="text-muted-foreground">Created at</span>
                  <p className="mt-0.5 font-medium text-foreground">
                    {formatFullDateTime(request.created_at)}
                  </p>
                </div>
                {request.resolved_at && (
                  <div>
                    <span className="text-muted-foreground">Resolved at</span>
                    <p className="mt-0.5 font-medium text-[#16a34a]">
                      {formatFullDateTime(request.resolved_at)}
                    </p>
                  </div>
                )}
                {request.closed_at && (
                  <div>
                    <span className="text-muted-foreground">Closed at</span>
                    <p className="mt-0.5 font-medium text-muted-foreground">
                      {formatFullDateTime(request.closed_at)}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Line Manager Assignment Card */}
          {request.can_manage && (
            <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <UserPlus className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                  Ticket Assignment
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Assign this request to a member of the{" "}
                  <span className="font-semibold text-foreground">
                    {request.department.name}
                  </span>{" "}
                  department.
                </p>
                <div className="space-y-2">
                  <UserCombobox
                    value={assignUserId}
                    onChange={(value) => setAssignUserId(value)}
                    apiEndpoint="/users"
                    additionalParams={{ department_id: request.department.id }}
                    placeholder="Select team member..."
                  />
                  {assignUserId === String(request.requester.id) && (
                    <p className="text-xs text-[#dc2626]">
                      Cannot assign to requester.
                    </p>
                  )}
                  <Button
                    className="w-full bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold h-9 shadow-sm"
                    onClick={handleAssign}
                    disabled={
                      actionLoading === "assign" ||
                      !assignUserId ||
                      assignUserId === String(request.requester.id)
                    }
                  >
                    {actionLoading === "assign" && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    {request.assigned_to ? "Reassign Member" : "Assign Handler"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Workflow Status Actions Card */}
          {request.can_act && (
            <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
              <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-3.5">
                <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <RefreshCw className="size-4 text-muted-foreground" />
                  Workflow Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 flex flex-col gap-2.5">
                {request.status === "assigned" && request.assigned_to && (
                  <Button
                    className="w-full bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold h-9 shadow-sm"
                    onClick={() => handleStatusChange("in_progress")}
                    disabled={actionLoading === "status"}
                  >
                    {actionLoading === "status" && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Start Working on Ticket
                  </Button>
                )}

                {request.status === "in_progress" && (
                  <Button
                    className="w-full bg-[#16a34a] hover:bg-[#15803d] text-white rounded-lg text-xs font-semibold h-9 shadow-sm"
                    onClick={() => handleAction("resolve")}
                    disabled={actionLoading === "resolve"}
                  >
                    {actionLoading === "resolve" && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Mark as Resolved
                  </Button>
                )}

                {request.status === "resolved" && (
                  <Button
                    className="w-full bg-[#16a34a] hover:bg-[#15803d] text-white rounded-lg text-xs font-semibold h-9 shadow-sm"
                    onClick={() => handleAction("confirm")}
                    disabled={actionLoading === "confirm"}
                  >
                    {actionLoading === "confirm" && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Confirm Resolution
                  </Button>
                )}

                {(request.status === "resolved" || request.status === "closed") && (
                  <Button
                    variant="outline"
                    className="w-full rounded-lg text-xs font-medium h-9 border-border"
                    onClick={() => handleAction("reopen")}
                    disabled={actionLoading === "reopen"}
                  >
                    {actionLoading === "reopen" && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    Reopen Request
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
