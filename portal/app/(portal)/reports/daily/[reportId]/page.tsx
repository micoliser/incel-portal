"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { format, formatDistanceToNow, isToday, parseISO } from "date-fns";
import { useEffect, useState } from "react";
import { useCallback } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Eye,
  Loader2,
  Mail,
  Plus,
  Users,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DailyReportSkeleton } from "@/components/skeletons/reports-skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { reportsAPI, type DailyReportDetail } from "@/lib/api/reports";

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

const MAX_FORWARD_RECIPIENTS = 5;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function SubreportCard({
  subreport,
  canOpen,
}: {
  subreport: DailyReportDetail["subreports"][number];
  canOpen: boolean;
}) {
  return (
    <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">
            {subreport.title}
          </p>
          <p className="text-sm text-muted-foreground">
            {subreport.created_by.full_name} · {subreport.comments_count}{" "}
            comment
            {subreport.comments_count === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            Created{" "}
            {formatDistanceToNow(parseISO(subreport.created_at), {
              addSuffix: true,
            })}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild disabled={!canOpen}>
          <Link href={subreport.view_url}>
            View
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function DailyReportPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = String(params.reportId);

  const [report, setReport] = useState<DailyReportDetail | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [isSendEmailOpen, setIsSendEmailOpen] = useState(false);
  const [recipientEmails, setRecipientEmails] = useState<string[]>([""]);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [reportData, profileResponse] = await Promise.all([
        reportsAPI.getDailyReport(reportId),
        apiClient.get("/me"),
      ]);
      setReport(reportData);
      setCurrentUserId(profileResponse.data.id ?? null);
      setLoadError(null);
      setActionError(null);
    } catch (err) {
      const message = extractApiErrorMessage(err, "Failed to load report");
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    if (reportId) {
      void loadData();
    }
  }, [loadData, reportId]);

  const canEdit = Boolean(report && currentUserId === report.creator.id);
  const reportIsToday = report ? isToday(parseISO(report.report_date)) : false;

  const resetSendEmailForm = () => {
    setRecipientEmails([""]);
    setSendEmailError(null);
  };

  const handleOpenSendEmail = () => {
    resetSendEmailForm();
    setIsSendEmailOpen(true);
  };

  const handleAddRecipientField = () => {
    if (recipientEmails.length >= MAX_FORWARD_RECIPIENTS) {
      return;
    }
    setRecipientEmails((current) => [...current, ""]);
  };

  const handleRecipientChange = (index: number, value: string) => {
    setRecipientEmails((current) =>
      current.map((email, emailIndex) =>
        emailIndex === index ? value : email,
      ),
    );
    setSendEmailError(null);
  };

  const handleRemoveRecipientField = (index: number) => {
    setRecipientEmails((current) => {
      if (current.length === 1) {
        return [""];
      }
      return current.filter((_, emailIndex) => emailIndex !== index);
    });
    setSendEmailError(null);
  };

  const handleSendEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!report) {
      return;
    }

    const recipients = recipientEmails
      .map((email) => email.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      setSendEmailError("Add at least one email address.");
      return;
    }

    const invalidIndex = recipients.findIndex((email) => !isValidEmail(email));
    if (invalidIndex !== -1) {
      setSendEmailError(`Enter a valid email address in field ${invalidIndex + 1}.`);
      return;
    }

    const seen = new Set<string>();
    for (const email of recipients) {
      const key = email.toLowerCase();
      if (seen.has(key)) {
        setSendEmailError("Remove duplicate email addresses.");
        return;
      }
      seen.add(key);
    }

    try {
      setIsSendingEmail(true);
      setSendEmailError(null);
      const response = await reportsAPI.sendDailyReportEmail(
        report.id,
        recipients,
      );
      toast.success(response.detail);
      setIsSendEmailOpen(false);
      resetSendEmailForm();
    } catch (err) {
      const message = extractApiErrorMessage(err, "Failed to send report email");
      setSendEmailError(message);
      toast.error(message);
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedComment = comment.trim();

    if (!trimmedTitle) {
      setActionError("A report title is required.");
      return;
    }

    if (!trimmedComment) {
      setActionError("A comment is required.");
      return;
    }

    if (!report) {
      return;
    }

    if (!reportIsToday) {
      setActionError("You can only add reports on the current day.");
      return;
    }

    try {
      setIsSubmitting(true);
      setActionError(null);
      await reportsAPI.createSubreport(report.id, trimmedTitle, trimmedComment);
      setTitle("");
      setComment("");
      toast.success("Report created.");
      await loadData();
    } catch (err) {
      const message = extractApiErrorMessage(err, "Failed to create the subreport");
      setActionError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <DailyReportSkeleton />;
  }

  if (loadError || !report) {
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
        onClick={() => router.back()}
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
          <CardHeader className="border-b border-border/60">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{report.title}</CardTitle>
                <CardDescription className="mt-1">
                  {format(parseISO(report.report_date), "EEEE, MMMM do yyyy")} ·{" "}
                  {report.department}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm dark:bg-slate-900/80">
                  {report.subreport_count} report
                  {report.subreport_count === 1 ? "" : "s"}
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleOpenSendEmail}
                  >
                    <Mail className="h-4 w-4" />
                    Send to email
                  </Button>
                ) : null}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <div className="rounded-2xl border border-border/60 bg-muted/30 p-4 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
                    Report owner
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {report.creator.full_name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Created{" "}
                    {formatDistanceToNow(parseISO(report.created_at), {
                      addSuffix: true,
                    })}
                  </p>
                </div>
                <Button variant="outline" asChild>
                  <Link href={`/reports/${report.report_date}`}>
                    Open day hub
                  </Link>
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">Reports</h3>
                  <p className="text-sm text-muted-foreground">
                    Click view on any report to view the full report page with
                    comments.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {report.subreports.length > 0 ? (
                  report.subreports.map((subreport) => (
                    <SubreportCard
                      key={subreport.id}
                      subreport={subreport}
                      canOpen={Boolean(currentUserId)}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No reports yet.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader>
              <CardTitle className="text-lg">Add a report</CardTitle>
              <CardDescription>
                Add an item attached to this daily report.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canEdit && reportIsToday ? (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="subreport-title">Title</Label>
                    <Input
                      id="subreport-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="What did you work on?"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subreport-comment">Comment</Label>
                    <textarea
                      id="subreport-comment"
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={5}
                      placeholder="Add the initial note for this report."
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
                      <Plus className="h-4 w-4" />
                    )}
                    Add report
                  </Button>
                </form>
              ) : canEdit ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Viewing only. Adding reports is disabled for non-current
                  dates.
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  Only the report owner can add reports from this page.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-white/90 shadow-sm dark:bg-slate-950/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-primary" />
                Reports
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <Eye className="h-4 w-4 text-primary" />
                <span>
                  Each item in the report links to a dedicated page with
                  comments.
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
                <Users className="h-4 w-4 text-primary" />
                <span>
                  The day hub shows this report alongside your department&apos;s
                  reports.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={isSendEmailOpen}
        onOpenChange={(open) => {
          setIsSendEmailOpen(open);
          if (!open) {
            resetSendEmailForm();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send report to email</DialogTitle>
            <DialogDescription>
              Forward this daily report with all report entries and comments.
              You can add up to {MAX_FORWARD_RECIPIENTS} recipients.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleSendEmail}>
            <div className="space-y-3">
              {recipientEmails.map((email, index) => (
                <div key={`recipient-${index}`} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`recipient-email-${index}`}>
                      Email {index + 1}
                    </Label>
                    {recipientEmails.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 py-1 text-xs text-muted-foreground"
                        onClick={() => handleRemoveRecipientField(index)}
                        disabled={isSendingEmail}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    id={`recipient-email-${index}`}
                    type="email"
                    value={email}
                    onChange={(event) =>
                      handleRecipientChange(index, event.target.value)
                    }
                    placeholder="colleague@example.com"
                    disabled={isSendingEmail}
                    autoComplete="email"
                  />
                </div>
              ))}
            </div>

            {recipientEmails.length < MAX_FORWARD_RECIPIENTS ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleAddRecipientField}
                disabled={isSendingEmail}
              >
                <Plus className="h-4 w-4" />
                Add another
              </Button>
            ) : null}

            {sendEmailError ? (
              <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{sendEmailError}</span>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSendEmailOpen(false)}
                disabled={isSendingEmail}
              >
                Cancel
              </Button>
              <Button type="submit" className="gap-2" disabled={isSendingEmail}>
                {isSendingEmail ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Send email
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
