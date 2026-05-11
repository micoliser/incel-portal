"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  endRecurringSchedule,
  getRecurringScheduleDetail,
} from "@/lib/api/tasks";
import type { RecurringSchedule } from "@/lib/api/tasks";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";

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
  const scheduleId = String(params.id);

  const [schedule, setSchedule] = useState<RecurringSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [isEnding, setIsEnding] = useState(false);

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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to end recurring task";
      toast.error(message);
      setError(message);
    } finally {
      setIsEnding(false);
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
          <Link href="/tasks">
            <Button type="button" variant="outline">
              Back to Tasks
            </Button>
          </Link>
        }
      />
    );
  }

  const canEnd =
    currentUserId === schedule.assigned_by.id && schedule.is_active;

  return (
    <div className="space-y-8">
      <Link
        href="/tasks"
        className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Tasks
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{schedule.title}</h1>
          <p className="mt-2 text-gray-600">
            {schedule.description || "No description"}
          </p>
        </div>
        <span
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            schedule.is_active
              ? "bg-emerald-100 text-emerald-800"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {schedule.is_active ? "Active" : "Ended"}
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
                {schedule.next_run_at
                  ? format(new Date(schedule.next_run_at), "MMM dd, yyyy HH:mm")
                  : "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Deadline Offset</p>
              <p className="font-medium">
                {schedule.deadline_offset_minutes} minutes
              </p>
            </div>
          </div>
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
            {schedule.ended_at ? (
              <div>
                <p className="text-gray-600">Ended At</p>
                <p className="font-medium">
                  {format(new Date(schedule.ended_at), "MMM dd, yyyy HH:mm")}
                </p>
              </div>
            ) : null}
          </div>

          {canEnd ? (
            <Button
              type="button"
              className="mt-6 w-full"
              variant="destructive"
              onClick={() => void handleEnd()}
              disabled={isEnding}
            >
              {isEnding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              End Recurring Task
            </Button>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
