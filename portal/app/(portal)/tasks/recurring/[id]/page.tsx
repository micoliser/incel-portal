"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Calendar,
  Clock,
  Repeat,
  Zap,
  Timer,
  Globe,
  Users,
  Pencil,
  Pause,
  Play,
  XCircle,
  CheckCircle2,
  CalendarOff,
  Flag,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  endRecurringSchedule,
  getRecurringScheduleDetail,
  pauseRecurringSchedule,
  resumeRecurringSchedule,
} from "@/lib/api/tasks";
import type { RecurringSchedule } from "@/lib/api/tasks";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { EditRecurringScheduleModal } from "@/components/edit-recurring-schedule-modal";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getInitials(name?: string | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatOffset(minutes: number): string {
  if (!minutes) return "0m (Immediate)";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function formatScheduleSummary(schedule: RecurringSchedule): string {
  if (schedule.frequency === "daily") {
    const base =
      schedule.interval === 1 ? "Every day" : `Every ${schedule.interval} days`;
    return schedule.include_weekends
      ? `${base} (including weekends)`
      : `${base} (weekdays only)`;
  }

  const days = schedule.weekdays
    .sort((a, b) => a - b)
    .map((day) => WEEKDAY_LABELS[day] ?? "")
    .filter(Boolean)
    .join(", ");

  const frequencyLabel =
    schedule.interval === 1 ? "Every week" : `Every ${schedule.interval} weeks`;

  return days ? `${frequencyLabel} on ${days}` : frequencyLabel;
}

const statusConfig: Record<
  string,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  active: {
    label: "Active",
    badgeClass:
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
    dotClass: "bg-emerald-500",
    description: "Schedule is active and generating tasks on schedule.",
  },
  paused: {
    label: "Paused",
    badgeClass:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    dotClass: "bg-amber-500",
    description: "Schedule is temporarily paused. Task creation is suspended.",
  },
  ended: {
    label: "Ended",
    badgeClass: "border-border/80 bg-muted text-muted-foreground",
    dotClass: "bg-muted-foreground",
    description: "Schedule has reached its end date or was manually ended.",
  },
};

const priorityConfig: Record<string, { label: string; badgeClass: string }> = {
  low: {
    label: "Low Priority",
    badgeClass: "border-border/80 bg-muted/40 text-muted-foreground",
  },
  medium: {
    label: "Medium Priority",
    badgeClass:
      "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  high: {
    label: "High Priority",
    badgeClass:
      "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-semibold",
  },
};

export default function RecurringTaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = String(params.id);

  const [schedule, setSchedule] = useState<RecurringSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [isPausingOrResuming, setIsPausingOrResuming] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [scheduleData, profileResponse] = await Promise.all([
          getRecurringScheduleDetail(scheduleId),
          apiClient.get("/me"),
        ]);
        setSchedule(scheduleData);
        setCurrentUserId(profileResponse.data.id ?? null);
        setError(null);
      } catch (err) {
        const message =
          extractApiErrorMessage(err, "Failed to load recurring task details");
        toast.error(message);
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    if (scheduleId) {
      fetchData();
    }
  }, [scheduleId]);

  const handleEnd = async () => {
    if (!schedule) return;

    try {
      setIsEnding(true);
      const updated = await endRecurringSchedule(schedule.id);
      setSchedule(updated);
      toast.success("Recurring schedule ended.");
      setEndConfirmOpen(false);
    } catch (err) {
      const message =
        extractApiErrorMessage(err, "Failed to end recurring task");
      toast.error(message);
      setError(message);
    } finally {
      setIsEnding(false);
    }
  };

  const handlePauseResume = async () => {
    if (!schedule) return;

    try {
      setIsPausingOrResuming(true);
      const updated = schedule.is_paused
        ? await resumeRecurringSchedule(schedule.id)
        : await pauseRecurringSchedule(schedule.id);
      setSchedule(updated);
      toast.success(
        updated.is_paused
          ? "Recurring schedule paused."
          : "Recurring schedule resumed.",
      );
    } catch (err) {
      const message = extractApiErrorMessage(
        err,
        schedule.is_paused
          ? "Failed to resume recurring task"
          : "Failed to pause recurring task",
      );
      toast.error(message);
      setError(message);
    } finally {
      setIsPausingOrResuming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !schedule) {
    return (
      <PageErrorCard
        title="Failed to load recurring task"
        message={error || "Recurring task not found"}
        onRetry={() => window.location.reload()}
        actions={
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Back to Tasks
          </Button>
        }
      />
    );
  }

  const canManage =
    currentUserId === schedule.assigned_by.id &&
    schedule.is_active &&
    !schedule.ended_at;

  const currentStatusKey = !schedule.is_active
    ? "ended"
    : schedule.is_paused
      ? "paused"
      : "active";
  const currentStatus = statusConfig[currentStatusKey];
  const currentPriority =
    priorityConfig[schedule.priority] ?? priorityConfig.medium;

  return (
    <div className="space-y-6 pb-12">
      {/* Back navigation */}
      <div>
        <Link
          href="/tasks"
          className="group inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
          <span>Back to Tasks</span>
        </Link>
      </div>

      {/* Header Banner Card */}
      <Card className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#0d47a1]/25 bg-[#0d47a1]/10 px-2.5 py-0.5 text-xs font-semibold text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                <Repeat className="size-3" aria-hidden="true" />
                Recurring Task Schedule
              </span>

              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  currentStatus.badgeClass,
                )}
              >
                <span className={cn("size-1.5 rounded-full", currentStatus.dotClass)} />
                {currentStatus.label}
              </span>

              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize",
                  currentPriority.badgeClass,
                )}
              >
                <Flag className="size-3" aria-hidden="true" />
                {currentPriority.label}
              </span>
            </div>

            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground break-words">
                {schedule.title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-3xl whitespace-pre-wrap">
                {schedule.description || "No description provided."}
              </p>
            </div>
          </div>

          {canManage && (
            <div className="flex flex-wrap items-center gap-2.5 pt-1 lg:pt-0 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handlePauseResume()}
                disabled={isPausingOrResuming}
                className="gap-2 font-medium shadow-xs"
              >
                {isPausingOrResuming ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : schedule.is_paused ? (
                  <Play className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Pause className="size-3.5 text-amber-600 dark:text-amber-400" />
                )}
                <span>{schedule.is_paused ? "Resume Schedule" : "Pause Schedule"}</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditOpen(true)}
                className="gap-1.5 font-medium shadow-xs"
              >
                <Pencil className="size-3.5 text-muted-foreground" />
                <span>Edit</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEndConfirmOpen(true)}
                disabled={isEnding}
                className="gap-1.5 font-medium text-[#dc2626] border-[#dc2626]/30 hover:bg-[#dc2626]/10 hover:text-[#dc2626] dark:border-[#dc2626]/40 dark:hover:bg-[#dc2626]/20"
              >
                <XCircle className="size-3.5" />
                <span>End Schedule</span>
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* 4 Metric Tiles Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Repeat className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Cadence</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {schedule.frequency === "daily"
                  ? schedule.interval === 1
                    ? "Every day"
                    : `Every ${schedule.interval} days`
                  : schedule.interval === 1
                    ? "Every week"
                    : `Every ${schedule.interval} weeks`}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground truncate border-t border-border/50 pt-2">
            {schedule.frequency === "daily"
              ? schedule.include_weekends
                ? "Includes Sat & Sun"
                : "Weekdays only (Mon–Fri)"
              : `${schedule.weekdays.length} active day(s)`}
          </p>
        </Card>

        <Card className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Clock className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Run Times</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {schedule.times.join(", ")}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground truncate border-t border-border/50 pt-2">
            {schedule.timezone}
          </p>
        </Card>

        <Card className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Zap className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Next Trigger</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {schedule.is_paused
                  ? "Paused"
                  : schedule.next_run_at
                    ? format(new Date(schedule.next_run_at), "MMM d, HH:mm")
                    : "No upcoming run"}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground truncate border-t border-border/50 pt-2">
            {schedule.is_paused
              ? "Resume to reactivate"
              : schedule.next_run_at
                ? "Auto-generates task"
                : "Schedule completed"}
          </p>
        </Card>

        <Card className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Timer className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">Deadline Offset</p>
              <p className="text-sm font-semibold text-foreground truncate">
                {formatOffset(schedule.deadline_offset_minutes)}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground truncate border-t border-border/50 pt-2">
            Due after task creation
          </p>
        </Card>
      </div>

      {/* Main Grid: Details & Stakeholders */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column: Schedule Configuration */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2.5 border-b border-border/70 pb-4 mb-5">
              <Calendar className="size-5 text-[#0d47a1] dark:text-[#38bdf8]" />
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  Schedule Configuration
                </h2>
                <p className="text-xs text-muted-foreground">
                  Automated recurrence rules, timing triggers, and deadline parameters.
                </p>
              </div>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Repeat className="size-3.5 text-muted-foreground/80" />
                  Pattern Summary
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {formatScheduleSummary(schedule)}
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Clock className="size-3.5 text-muted-foreground/80" />
                  Scheduled Run Times
                </p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {schedule.times.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center rounded-md border border-border/80 bg-background px-2 py-0.5 text-xs font-mono font-medium text-foreground"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Globe className="size-3.5 text-muted-foreground/80" />
                  Timezone
                </p>
                <p className="text-sm font-semibold text-foreground font-mono">
                  {schedule.timezone}
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Timer className="size-3.5 text-muted-foreground/80" />
                  Deadline Offset
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {formatOffset(schedule.deadline_offset_minutes)}{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({schedule.deadline_offset_minutes} minutes)
                  </span>
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Calendar className="size-3.5 text-muted-foreground/80" />
                  Starts At
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {format(new Date(schedule.start_at), "MMM dd, yyyy · HH:mm")}
                </p>
              </div>

              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-1">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <CalendarOff className="size-3.5 text-muted-foreground/80" />
                  Ends At
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {schedule.end_at
                    ? format(new Date(schedule.end_at), "MMM dd, yyyy · HH:mm")
                    : "Ongoing (No end date)"}
                </p>
              </div>
            </div>

            {/* Paused or Ended Alert Banners */}
            {schedule.is_paused && (
              <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3.5 items-start">
                <AlertTriangle className="size-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Schedule Currently Paused
                  </p>
                  <p className="text-xs text-amber-700/90 dark:text-amber-400/90 leading-relaxed">
                    This schedule was paused{" "}
                    {schedule.paused_at
                      ? `on ${format(new Date(schedule.paused_at), "MMM dd, yyyy · HH:mm")}`
                      : ""}{" "}
                    {schedule.paused_by ? `by ${schedule.paused_by.full_name}` : ""}.
                    Task generation is paused and will resume from the next
                    calculated trigger when reactivated.
                  </p>
                </div>
              </div>
            )}

            {(!schedule.is_active || schedule.ended_at) && (
              <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4 flex gap-3.5 items-start">
                <CheckCircle2 className="size-5 text-muted-foreground shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    Recurring Schedule Has Concluded
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    This recurring task schedule ended{" "}
                    {schedule.ended_at
                      ? `on ${format(new Date(schedule.ended_at), "MMM dd, yyyy · HH:mm")}`
                      : ""}{" "}
                    {schedule.ended_by ? `by ${schedule.ended_by.full_name}` : ""}.
                    No further tasks will be created from this template.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right Column: Stakeholders & Automation Overview */}
        <div className="space-y-6">
          <Card className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2.5 border-b border-border/70 pb-4 mb-5">
              <Users className="size-5 text-[#0d47a1] dark:text-[#38bdf8]" />
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  People & Ownership
                </h2>
                <p className="text-xs text-muted-foreground">
                  Assigner and assignee responsible for this schedule.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Assigned To */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Assigned Performer
                  </span>
                  <span className="rounded-full bg-[#0d47a1]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                    Task Assignee
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1] text-xs font-semibold text-white shadow-xs">
                    {getInitials(schedule.assigned_to.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {schedule.assigned_to.full_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {schedule.assigned_to.email}
                    </p>
                  </div>
                </div>
              </div>

              {/* Created By */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Created By
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Schedule Creator
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-foreground border border-border">
                    {getInitials(schedule.assigned_by.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {schedule.assigned_by.full_name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {schedule.assigned_by.email}
                    </p>
                  </div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Created</span>
                  <span className="font-medium text-foreground">
                    {format(new Date(schedule.created_at), "MMM dd, yyyy")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Last Updated</span>
                  <span className="font-medium text-foreground">
                    {format(new Date(schedule.updated_at), "MMM dd, yyyy")}
                  </span>
                </div>
              </div>
            </div>
          </Card>

          {/* Automation Overview Card */}
          <Card className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
            <div className="flex items-center gap-2.5 border-b border-border/70 pb-4 mb-4">
              <Sparkles className="size-4.5 text-[#0d47a1] dark:text-[#38bdf8]" />
              <h3 className="text-sm font-semibold text-foreground">
                Automation Overview
              </h3>
            </div>
            <ul className="space-y-2.5 text-xs text-muted-foreground leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8] shrink-0 mt-1.5" />
                <span>
                  Tasks generate automatically in the background at each configured run time.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8] shrink-0 mt-1.5" />
                <span>
                  Deadlines are automatically calculated from task creation time plus deadline offset.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="size-1.5 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8] shrink-0 mt-1.5" />
                <span>
                  Generated tasks appear in the assignee&apos;s active task dashboard ready for execution.
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Edit Recurring Schedule Modal */}
      <EditRecurringScheduleModal
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        schedule={schedule}
        onSaved={(updated) => setSchedule(updated)}
      />

      {/* End Schedule Confirmation Dialog */}
      <Dialog open={endConfirmOpen} onOpenChange={setEndConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<AlertTriangle className="size-4.5" />}
            iconClassName="bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400"
          >
            <DialogTitle>End Recurring Task Schedule?</DialogTitle>
            <DialogDescription>
              Are you sure you want to end &quot;{schedule.title}&quot;? Future tasks
              will no longer be generated from this template. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          <div className="my-1 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-700 dark:text-rose-400 space-y-1">
            <p className="font-semibold">What will happen:</p>
            <p className="text-muted-foreground dark:text-rose-400/80">
              • Previously generated tasks remain active on member boards.
              <br />
              • The schedule status changes to &quot;Ended&quot;.
              <br />
              • Automated background task generation stops permanently.
            </p>
          </div>

          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEndConfirmOpen(false)}
              disabled={isEnding}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleEnd()}
              disabled={isEnding}
              className="gap-2"
            >
              {isEnding ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Ending schedule...</span>
                </>
              ) : (
                <>
                  <XCircle className="size-3.5" />
                  <span>End Schedule</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
