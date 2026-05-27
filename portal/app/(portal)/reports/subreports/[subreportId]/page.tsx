"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format, formatDistanceToNow, isToday, parseISO } from "date-fns";
import axios from "axios";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  Loader2,
  MessageSquare,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { reportsAPI, type DailyReportSubreportDetail } from "@/lib/api/reports";

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

function CommentCard({
  comment,
}: {
  comment: DailyReportSubreportDetail["comments"][number];
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm dark:bg-slate-950/60">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-foreground">
            {comment.author.full_name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(parseISO(comment.created_at), {
              addSuffix: true,
            })}
          </p>
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
        {comment.body}
      </p>
    </div>
  );
}

export default function SubreportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const subreportId = String(params.subreportId);

  const [subreport, setSubreport] = useState<DailyReportSubreportDetail | null>(
    null,
  );
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [comment, setComment] = useState("");

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [subreportData, profileResponse] = await Promise.all([
          reportsAPI.getSubreport(subreportId),
          apiClient.get("/me"),
        ]);
        setSubreport(subreportData);
        setCurrentUserId(profileResponse.data.id ?? null);
        setLoadError(null);
        setActionError(null);
      } catch (err) {
        const message = extractApiErrorMessage(
          err,
          err instanceof Error ? err.message : "Failed to load subreport",
        );
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    };

    if (subreportId) {
      void loadData();
    }
  }, [subreportId]);

  const isOwner = Boolean(
    subreport && currentUserId === subreport.created_by.id,
  );
  const subreportIsToday = subreport
    ? isToday(parseISO(subreport.report_date))
    : false;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = comment.trim();
    if (!trimmed) {
      setActionError("Comment cannot be empty.");
      return;
    }

    if (!subreport) {
      return;
    }

    if (!subreportIsToday) {
      setActionError("You can only add comments on the current day.");
      return;
    }

    try {
      setIsSubmitting(true);
      setActionError(null);
      const created = await reportsAPI.addComment(subreport.id, trimmed);
      setComment("");
      toast.success("Comment added.");
      setSubreport((current) =>
        current
          ? {
              ...current,
              comments: [...current.comments, created],
            }
          : current,
      );
    } catch (err) {
      const message = extractApiErrorMessage(
        err,
        err instanceof Error ? err.message : "Failed to post the comment",
      );
      setActionError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-background/80 px-5 py-4 shadow-sm backdrop-blur">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm font-medium text-muted-foreground">
            Loading report...
          </span>
        </div>
      </div>
    );
  }

  if (loadError || !subreport) {
    return (
      <PageErrorCard
        title="Failed to load report"
        message={loadError || "Report not found."}
        onRetry={() => window.location.reload()}
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/reports")}
          >
            Back to calendar
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-8 px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          router.push(`/reports/daily/${subreport.daily_report_id}`)
        }
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to report
      </Button>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{subreport.title}</CardTitle>
                <CardDescription className="mt-1">
                  {subreport.created_by.full_name} ·{" "}
                  {format(
                    parseISO(subreport.report_date),
                    "EEEE, MMMM do yyyy",
                  )}
                </CardDescription>
              </div>
              <Button asChild variant="outline">
                <Link href={`/reports/daily/${subreport.daily_report_id}`}>
                  Open daily report
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
              <div className="mt-3 grid gap-3 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Created by</p>
                  <p className="font-medium">
                    {subreport.created_by.full_name}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="font-medium">
                    {formatDistanceToNow(parseISO(subreport.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Comments</p>
                  <p className="font-medium">{subreport.comments.length}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Daily report date</p>
                  <p className="font-medium">{subreport.report_date}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Comments</h3>
                  <p className="text-sm text-muted-foreground">
                    See all comments for this report item.
                  </p>
                </div>
              </div>

              {subreport.comments.length > 0 ? (
                <div className="space-y-3">
                  {subreport.comments.map((commentItem) => (
                    <CommentCard key={commentItem.id} comment={commentItem} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No comments yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader>
              <CardTitle className="text-lg">Add comment</CardTitle>
              <CardDescription>
                Append a new note to this report item.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isOwner && subreportIsToday ? (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="comment-body">Comment</Label>
                    <textarea
                      id="comment-body"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={5}
                      placeholder="Add follow-up details or context."
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isSubmitting}
                    />
                  </div>

                  {actionError ? (
                    <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      <span>{actionError}</span>
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    className="w-full gap-2"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Append comment
                  </Button>
                </form>
              ) : isOwner ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Viewing only. Adding comments is disabled for non-current
                  dates.
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Only the report owner can append comments here.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-primary" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <MessageSquare className="h-4 w-4 text-primary" />
                <span>Every comment is stored in creation order.</span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <ArrowLeft className="h-4 w-4 text-primary" />
                <span>Jump back to the parent daily report any time.</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
