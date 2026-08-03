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
} from "@/lib/api/support";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { getUploadUrl, confirmUpload } from "@/lib/api/support";

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
      const { upload_url } = await getUploadUrl(request.id, {
        file_name: file.name,
        content_type: file.type || "application/octet-stream",
        size: file.size,
      });

      await fetch(upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });

      const url = new URL(upload_url);
      const objectKey = decodeURIComponent(url.pathname.split("/").pop() || "");

      await confirmUpload(request.id, {
        object_key: objectKey,
        file_name: file.name,
        content_type: file.type || "application/octet-stream",
        size: file.size,
      });

      toast.success("File attached.");
      void loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to attach file."));
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <SupportDetailSkeleton />
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/support")}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-xl font-bold">{request.title}</h1>
            <Badge className={STATUS_COLORS[request.status]} variant="outline">
              {request.status.replace("_", " ")}
            </Badge>
            <Badge
              className={PRIORITY_COLORS[request.priority]}
              variant="outline"
            >
              {request.priority}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {request.requester.full_name} &middot; {request.department.name}{" "}
            &middot; {request.category.replace("_", " ")}
          </p>
        </div>
      </div>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Description</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{request.description}</p>
        </CardContent>
      </Card>

      {/* Assignment — only visible to line managers */}
      {request.can_manage && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" />
              Assign to a Team Member
            </CardTitle>
          </CardHeader>
          <CardContent>
            {request.assigned_to ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  This request is currently assigned to:
                </p>
                <p className="text-sm font-medium">
                  {request.assigned_to.full_name}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You can assign this request to a team member from the{" "}
                  <span className="font-medium">{request.department.name}</span>{" "}
                  department to handle it.
                </p>
                <div className="flex items-center gap-2">
                  <div className="w-56">
                    <UserCombobox
                      value={assignUserId}
                      onChange={(value) => setAssignUserId(value)}
                      apiEndpoint="/users"
                      additionalParams={{ department_id: request.department.id }}
                      placeholder="Select a team member..."
                    />
                    {assignUserId === String(request.requester.id) && (
                      <p className="text-xs text-red-500 mt-1">Cannot assign to requester.</p>
                    )}
                  </div>
                  <Button
                    className="min-w-28"
                    size="default"
                    onClick={handleAssign}
                    disabled={actionLoading === "assign" || !assignUserId || assignUserId === String(request.requester.id)}
                  >
                    {actionLoading === "assign" && (
                      <Loader2 className="mr-1 size-3 animate-spin" />
                    )}
                    Assign
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions — only visible to line managers or assigned handler */}
      {request.can_act && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {request.status === "assigned" && request.assigned_to && (
              <Button
                size="sm"
                onClick={() => handleStatusChange("in_progress")}
                disabled={actionLoading === "status"}
              >
                {actionLoading === "status" && (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                )}
                Start Working
              </Button>
            )}
            {request.status === "in_progress" && (
              <Button
                size="sm"
                onClick={() => handleAction("resolve")}
                disabled={actionLoading === "resolve"}
              >
                {actionLoading === "resolve" && (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                )}
                Mark Resolved
              </Button>
            )}
            {request.status === "resolved" && (
              <Button
                size="sm"
                onClick={() => handleAction("confirm")}
                disabled={actionLoading === "confirm"}
              >
                {actionLoading === "confirm" && (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                )}
                Confirm Resolution
              </Button>
            )}
            {(request.status === "resolved" || request.status === "closed") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleAction("reopen")}
                disabled={actionLoading === "reopen"}
              >
                {actionLoading === "reopen" && (
                  <Loader2 className="mr-1 size-3 animate-spin" />
                )}
                Reopen
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Attachments (request-level) */}
      {request.attachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attachments</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {request.attachments.map((att) => (
                <li key={att.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="size-3.5 text-muted-foreground" />
                  <span>{att.file_name}</span>
                  {att.download_url && (
                    <a
                      href={att.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-primary hover:underline"
                    >
                      <Download className="size-3.5 inline" /> Download
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Timeline ({request.comments.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {request.comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          )}
          {request.comments.map((comment) => (
            <div
              key={comment.id}
              className={`rounded-lg border p-3 ${
                comment.is_system ? "bg-muted/30" : ""
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {comment.author.full_name}
                </span>
                {comment.is_system && (
                  <Badge variant="outline" className="text-[10px]">
                    system
                  </Badge>
                )}
                <span>&middot;</span>
                <span>{new Date(comment.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
              {comment.attachments.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {comment.attachments.map((att) => (
                    <li
                      key={att.id}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Paperclip className="size-3" />
                      <span>{att.file_name}</span>
                      {att.download_url && (
                        <a
                          href={att.download_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-primary hover:underline"
                        >
                          Download
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Add comment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a Comment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Type your reply..."
            rows={3}
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
              >
                <Paperclip className="mr-1 size-4" />
                Attach File
              </Button>
            </div>
            <Button
              onClick={handleAddComment}
              disabled={submittingComment || !commentText.trim()}
            >
              {submittingComment ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
