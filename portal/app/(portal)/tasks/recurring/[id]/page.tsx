"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatScheduleSummary(schedule: RecurringSchedule): string {
  if (schedule.frequency === "daily") {
    return schedule.interval === 1
      ? "Every day"
      : `Every ${schedule.interval} days`;
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
          err instanceof Error
            ? err.message
            : "Failed to load recurring task details";
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
      toast.success("Recurring task ended.");
      setEndConfirmOpen(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to end recurring task";
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
          ? "Recurring task paused."
          : "Recurring task resumed.",
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : schedule.is_paused
            ? "Failed to resume recurring task"
            : "Failed to pause recurring task";
      toast.error(message);
      setError(message);
    } finally {
      setIsPausingOrResuming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
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
    currentUserId === schedule.assigned_by.id && schedule.is_active;
  const statusLabel = !schedule.is_active
    ? "Ended"
    : schedule.is_paused
      ? "Paused"
      : "Active";
  const statusClasses = !schedule.is_active
    ? "bg-gray-100 text-gray-700"
    : schedule.is_paused
      ? "bg-amber-100 text-amber-800"
      : "bg-emerald-100 text-emerald-800";

  return (
    <div className="space-y-8">
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tasks
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{schedule.title}</h1>
          <p className="mt-2 text-gray-600">
            {schedule.description || "No description"}
          </p>
        </div>
        <span
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${statusClasses}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold">Schedule Details</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-gray-600">Pattern</p>
              <p className="font-medium">{formatScheduleSummary(schedule)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Run Times</p>
              <p className="font-medium">{schedule.times.join(", ")}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Timezone</p>
              <p className="font-medium">{schedule.timezone}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Priority</p>
              <p className="font-medium capitalize">{schedule.priority}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Starts At</p>
              <p className="font-medium">
                {format(new Date(schedule.start_at), "MMM dd, yyyy HH:mm")}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Ends At</p>
              <p className="font-medium">
                {schedule.end_at
                  ? format(new Date(schedule.end_at), "MMM dd, yyyy HH:mm")
                  : "No end date"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Next Run</p>
              <p className="font-medium">
                {schedule.is_paused
                  ? "Paused - resumes from the next calculated run after resume"
                  : schedule.next_run_at
                    ? format(
                        new Date(schedule.next_run_at),
                        "MMM dd, yyyy HH:mm",
                      )
                    : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Deadline Offset</p>
              <p className="font-medium">
                {schedule.deadline_offset_minutes} minutes
              </p>
            </div>
            {schedule.is_paused ? (
              <div>
                <p className="text-sm text-gray-600">Paused At</p>
                <p className="font-medium">
                  {schedule.paused_at
                    ? format(new Date(schedule.paused_at), "MMM dd, yyyy HH:mm")
                    : "Paused"}
                </p>
              </div>
            ) : null}
          </div>

          {canManage ? (
            <div className="mt-6">
              <Button
                type="button"
                className="px-12"
                variant="outline"
                onClick={() => setIsEditOpen(true)}
              >
                Edit
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-lg font-semibold">Assignment</h2>
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-gray-600">Created By</p>
              <p className="font-medium">{schedule.assigned_by.full_name}</p>
              <p className="text-xs text-gray-500">
                {schedule.assigned_by.email}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Assigned To</p>
              <p className="font-medium">{schedule.assigned_to.full_name}</p>
              <p className="text-xs text-gray-500">
                {schedule.assigned_to.email}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Created</p>
              <p className="font-medium">
                {format(new Date(schedule.created_at), "MMM dd, yyyy HH:mm")}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Last Updated</p>
              <p className="font-medium">
                {format(new Date(schedule.updated_at), "MMM dd, yyyy HH:mm")}
              </p>
            </div>
            {schedule.paused_by ? (
              <div>
                <p className="text-gray-600">Paused By</p>
                <p className="font-medium">{schedule.paused_by.full_name}</p>
                <p className="text-xs text-gray-500">
                  {schedule.paused_by.email}
                </p>
              </div>
            ) : null}
            {schedule.ended_at ? (
              <div>
                <p className="text-gray-600">Ended At</p>
                <p className="font-medium">
                  {format(new Date(schedule.ended_at), "MMM dd, yyyy HH:mm")}
                </p>
              </div>
            ) : null}
          </div>

          {canManage ? (
            <div className="mt-6 space-y-3">
              <div className="flex gap-3">
                <Button
                  type="button"
                  className="flex-1"
                  variant="secondary"
                  onClick={() => void handlePauseResume()}
                  disabled={isPausingOrResuming}
                >
                  {isPausingOrResuming ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {schedule.is_paused ? "Resume" : "Pause"}
                </Button>

                <Button
                  type="button"
                  className="flex-1"
                  variant="destructive"
                  onClick={() => setEndConfirmOpen(true)}
                  disabled={isEnding}
                >
                  {isEnding ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  End
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </div>

      <EditRecurringScheduleModal
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        schedule={schedule}
        onSaved={(updated) => setSchedule(updated)}
      />

      <Dialog open={endConfirmOpen} onOpenChange={setEndConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End Recurring Task</DialogTitle>
            <DialogDescription>
              Are you sure you want to end this recurring task? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-4">
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
            >
              {isEnding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ending...
                </>
              ) : (
                "End Task"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
