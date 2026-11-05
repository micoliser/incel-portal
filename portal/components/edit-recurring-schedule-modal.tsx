"use client";
import { extractApiErrorMessage } from "@/lib/api-errors";

import { useEffect, useState } from "react";
import { AlertCircle, HelpCircle, Loader2, Check, Repeat } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  updateRecurringSchedule,
  type RecurringSchedule,
} from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
];

const TIMEZONE_OPTIONS = [
  { value: "Asia/Dubai", label: "Dubai (GST, UTC+4)" },
  { value: "Africa/Lagos", label: "Nigeria (WAT, UTC+1)" },
];

type FormErrors = Partial<{
  title: string;
  frequency: string;
  interval: string;
  weekdays: string;
  times: string;
  timezone: string;
  start_at: string;
  end_at: string;
  deadline_offset_minutes: string;
}>;

function getDatetimeLocalValue(dateString: string | null | undefined) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function getDatetimeLocalMin() {
  const now = new Date();
  now.setSeconds(0, 0);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function formatAssigneeName(schedule: RecurringSchedule) {
  const fullName = schedule.assigned_to.full_name.trim();
  return fullName
    ? `${fullName} (${schedule.assigned_to.email})`
    : schedule.assigned_to.email;
}

function arraysEqual(a: string[] | number[], b: string[] | number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function validateForm(
  formData: {
    title: string;
    frequency: string;
    interval: string;
    include_weekends: boolean;
    weekdays: number[];
    times: string[];
    timezone: string;
    start_at: string;
    end_at: string;
    deadline_offset_minutes: string;
  },
  deadlineMin: string,
  hasStarted: boolean,
): FormErrors {
  const errors: FormErrors = {};

  if (!formData.title.trim()) {
    errors.title = "Schedule title is required.";
  }

  if (!formData.frequency) {
    errors.frequency = "Frequency is required.";
  }

  if (!formData.interval || Number(formData.interval) < 1) {
    errors.interval = "Interval must be at least 1.";
  }

  if (!formData.times.length) {
    errors.times = "Add at least one time.";
  } else if (
    formData.times.some((value) => !/^([0-1]?\d|2[0-3]):[0-5]\d$/.test(value))
  ) {
    errors.times = "Times must use HH:MM format.";
  }

  if (formData.frequency === "weekly" && formData.weekdays.length === 0) {
    errors.weekdays = "Select at least one weekday.";
  }

  if (!hasStarted) {
    if (!formData.start_at) {
      errors.start_at = "Start date is required.";
    } else if (new Date(formData.start_at) < new Date(deadlineMin)) {
      errors.start_at = "Start date cannot be in the past.";
    }
  }

  if (formData.end_at && formData.start_at) {
    const startAt = new Date(formData.start_at);
    const endAt = new Date(formData.end_at);
    if (endAt < startAt) {
      errors.end_at = "End date must be after the start date.";
    }
  }

  if (
    !formData.timezone ||
    !TIMEZONE_OPTIONS.some((tz) => tz.value === formData.timezone)
  ) {
    errors.timezone = "Please select a valid timezone.";
  }

  if (
    formData.deadline_offset_minutes &&
    Number(formData.deadline_offset_minutes) < 0
  ) {
    errors.deadline_offset_minutes = "Deadline offset cannot be negative.";
  }

  return errors;
}

interface EditRecurringScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: RecurringSchedule | null;
  onSaved: (schedule: RecurringSchedule) => void;
}

export function EditRecurringScheduleModal({
  open,
  onOpenChange,
  schedule,
  onSaved,
}: EditRecurringScheduleModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    priority: "medium" as RecurringSchedule["priority"],
    frequency: "daily" as RecurringSchedule["frequency"],
    interval: "1",
    include_weekends: false,
    weekdays: [] as number[],
    times: ["09:00"],
    timezone: "Asia/Dubai",
    start_at: "",
    end_at: "",
    deadline_offset_minutes: "0",
  });
  const [deadlineOffsetHours, setDeadlineOffsetHours] = useState("0");
  const [deadlineOffsetMins, setDeadlineOffsetMins] = useState("0");
  const deadlineMin = getDatetimeLocalMin();
  const hasStarted = Boolean(
    schedule && new Date(schedule.start_at) <= new Date(),
  );

  useEffect(() => {
    if (!schedule) return;

    setFormData({
      title: schedule.title,
      description: schedule.description,
      priority: schedule.priority,
      frequency: schedule.frequency,
      interval: String(schedule.interval),
      include_weekends: schedule.include_weekends ?? false,
      weekdays: [...schedule.weekdays],
      times: [...schedule.times],
      timezone: schedule.timezone,
      start_at: getDatetimeLocalValue(schedule.start_at),
      end_at: getDatetimeLocalValue(schedule.end_at),
      deadline_offset_minutes: String(schedule.deadline_offset_minutes),
    });
    setFormErrors({});
    setApiError(null);
    // sync hours/mins
    const total = schedule.deadline_offset_minutes || 0;
    setDeadlineOffsetHours(String(Math.floor(total / 60)));
    setDeadlineOffsetMins(String(total % 60));
  }, [schedule, open]);

  const resetAndClose = () => {
    setFormErrors({});
    setApiError(null);
    onOpenChange(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schedule) return;

    // Check if any changes have been made
    const hasChanges =
      formData.title.trim() !== schedule.title ||
      formData.description.trim() !== (schedule.description || "") ||
      formData.priority !== schedule.priority ||
      formData.frequency !== schedule.frequency ||
      Number(formData.interval) !== schedule.interval ||
      formData.include_weekends !== (schedule.include_weekends ?? false) ||
      !arraysEqual(formData.weekdays, schedule.weekdays) ||
      !arraysEqual(formData.times, schedule.times) ||
      formData.timezone !== schedule.timezone ||
      (!hasStarted &&
        formData.start_at !== getDatetimeLocalValue(schedule.start_at)) ||
      formData.end_at !== getDatetimeLocalValue(schedule.end_at) ||
      Number(formData.deadline_offset_minutes || 0) !==
        schedule.deadline_offset_minutes;

    if (!hasChanges) {
      toast.info("No changes detected.");
      return;
    }

    const validationErrors = validateForm(formData, deadlineMin, hasStarted);
    setFormErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setSubmitting(true);
      const updated = await updateRecurringSchedule(schedule.id, {
        title: formData.title,
        description: formData.description,
        priority: formData.priority,
        frequency: formData.frequency,
        interval: Number(formData.interval),
        include_weekends: formData.include_weekends,
        weekdays: formData.weekdays,
        times: formData.times,
        timezone: formData.timezone,
        deadline_offset_minutes: Number(formData.deadline_offset_minutes || 0),
        ...(hasStarted
          ? {}
          : { start_at: new Date(formData.start_at).toISOString() }),
        end_at: formData.end_at
          ? new Date(formData.end_at).toISOString()
          : null,
      });
      toast.success("Recurring schedule updated successfully");
      onSaved(updated);
      resetAndClose();
    } catch (err) {
      setApiError(
        extractApiErrorMessage(err, "Failed to update recurring schedule"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!schedule) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetAndClose();
        } else {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader icon={<Repeat className="size-4.5" />}>
          <DialogTitle>Edit Recurring Task</DialogTitle>
          <DialogDescription>
            Update the schedule details. The assignee cannot be changed.
          </DialogDescription>
        </DialogHeader>

        {apiError ? (
          <div className="flex gap-3 rounded-lg border border-[#dc2626]/25 bg-[#dc2626]/10 p-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#dc2626]" />
            <div className="text-sm text-[#dc2626]">{apiError}</div>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Assignee
          </p>
          <p className="mt-1 font-medium">{formatAssigneeName(schedule)}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="title">Task Title *</Label>
            <Input
              id="title"
              type="text"
              placeholder="Enter task title"
              value={formData.title}
              onChange={(event) => {
                setFormData({ ...formData, title: event.target.value });
                setFormErrors((current) => ({ ...current, title: undefined }));
              }}
              disabled={submitting}
              className="mt-2"
              aria-invalid={Boolean(formErrors.title)}
            />
            {formErrors.title ? (
              <p className="mt-1 text-xs text-destructive">
                {formErrors.title}
              </p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              placeholder="Enter task description"
              value={formData.description}
              onChange={(event) =>
                setFormData({ ...formData, description: event.target.value })
              }
              disabled={submitting}
              className="mt-2 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-[#0d47a1] focus:outline-none dark:border-border dark:bg-card dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="priority">Priority</Label>
              <select
                id="priority"
                value={formData.priority}
                onChange={(event) =>
                  setFormData({
                    ...formData,
                    priority: event.target
                      .value as RecurringSchedule["priority"],
                  })
                }
                disabled={submitting}
                className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm focus:border-[#0d47a1] focus:outline-none dark:border-border dark:bg-card dark:text-white"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <Label htmlFor="start_at">Start At</Label>
              <Input
                id="start_at"
                type="datetime-local"
                value={formData.start_at}
                onChange={(event) => {
                  const nextStartAt = event.target.value;
                  let nextTimes = [...formData.times];
                  if (nextStartAt && nextStartAt.includes("T")) {
                    const timePart = nextStartAt.split("T")[1]?.slice(0, 5);
                    if (/^([0-1]?\d|2[0-3]):[0-5]\d$/.test(timePart)) {
                      if (nextTimes.length === 0) {
                        nextTimes = [timePart];
                      } else {
                        nextTimes[0] = timePart;
                      }
                    }
                  }
                  setFormData({
                    ...formData,
                    start_at: nextStartAt,
                    times: nextTimes,
                  });
                  setFormErrors((current) => ({
                    ...current,
                    start_at: undefined,
                    times: undefined,
                  }));
                }}
                disabled={submitting || hasStarted}
                min={deadlineMin}
                className="mt-2"
                aria-invalid={Boolean(formErrors.start_at)}
              />
              {hasStarted ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Start date can no longer be changed because the schedule has
                  already started.
                </p>
              ) : null}
              {formErrors.start_at ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.start_at}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-border p-4 dark:border-border">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="frequency">Frequency</Label>
                <select
                  id="frequency"
                  value={formData.frequency}
                  onChange={(event) =>
                    setFormData({
                      ...formData,
                      frequency: event.target
                        .value as RecurringSchedule["frequency"],
                    })
                  }
                  disabled={submitting}
                  className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-[#0d47a1] focus:outline-none dark:bg-card dark:text-foreground"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
                {formErrors.frequency ? (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.frequency}
                  </p>
                ) : null}
              </div>

              <div>
                <Label htmlFor="interval">
                  Every N {formData.frequency === "weekly" ? "weeks" : "days"}
                </Label>
                <Input
                  id="interval"
                  type="number"
                  min="1"
                  value={formData.interval}
                  onChange={(event) => {
                    setFormData({ ...formData, interval: event.target.value });
                    setFormErrors((current) => ({
                      ...current,
                      interval: undefined,
                    }));
                  }}
                  disabled={submitting}
                  className="mt-2"
                  aria-invalid={Boolean(formErrors.interval)}
                />
                {formErrors.interval ? (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.interval}
                  </p>
                ) : null}
              </div>
            </div>

            {formData.frequency === "daily" ? (
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={formData.include_weekends}
                  onClick={() =>
                    setFormData((current) => ({
                      ...current,
                      include_weekends: !current.include_weekends,
                    }))
                  }
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    formData.include_weekends
                      ? "border-[#0d47a1] bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/15 dark:text-[#38bdf8] dark:border-[#0d47a1]/30"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      formData.include_weekends
                        ? "border-[#0d47a1] bg-[#0d47a1] text-white"
                        : "border-border dark:border-border",
                    )}
                  >
                    {formData.include_weekends && (
                      <Check className="h-3 w-3 stroke-[3]" />
                    )}
                  </div>
                  <span>Include Weekends</span>
                </button>
                <span className="text-xs text-muted-foreground">
                  {formData.include_weekends
                    ? "Tasks will generate every day including Saturday & Sunday"
                    : "Tasks will generate on weekdays only (Mon – Fri)"}
                </span>
              </div>
            ) : null}

            {formData.frequency === "weekly" ? (
              <div>
                <Label>Weekdays</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEKDAY_OPTIONS.map((weekday) => {
                    const checked = formData.weekdays.includes(weekday.value);
                    return (
                      <Button
                        key={weekday.value}
                        type="button"
                        variant={checked ? "default" : "outline"}
                        className="h-9 rounded-full px-3 text-xs"
                        onClick={() => {
                          setFormData((current) => ({
                            ...current,
                            weekdays: current.weekdays.includes(weekday.value)
                              ? current.weekdays.filter(
                                  (value) => value !== weekday.value,
                                )
                              : [...current.weekdays, weekday.value],
                          }));
                          setFormErrors((current) => ({
                            ...current,
                            weekdays: undefined,
                          }));
                        }}
                        disabled={submitting}
                      >
                        {weekday.label}
                      </Button>
                    );
                  })}
                </div>
                {formErrors.weekdays ? (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.weekdays}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div>
              <div className="flex items-center justify-between gap-3">
                <Label>Run Times</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() =>
                    setFormData((current) => ({
                      ...current,
                      times: [...current.times, "09:00"],
                    }))
                  }
                  disabled={submitting}
                >
                  Add time
                </Button>
              </div>
              <div className="mt-2 space-y-2">
                {formData.times.map((time, index) => (
                  <div key={`${index}-${time}`} className="flex gap-2">
                    <Input
                      type="time"
                      value={time}
                      onChange={(event) => {
                        const nextTimes = [...formData.times];
                        nextTimes[index] = event.target.value;
                        setFormData({ ...formData, times: nextTimes });
                        setFormErrors((current) => ({
                          ...current,
                          times: undefined,
                        }));
                      }}
                      disabled={submitting}
                    />
                    {formData.times.length > 1 ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        onClick={() =>
                          setFormData((current) => ({
                            ...current,
                            times: current.times.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          }))
                        }
                        disabled={submitting}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              {formErrors.times ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.times}
                </p>
              ) : null}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="timezone">Timezone *</Label>
                <select
                  id="timezone"
                  value={formData.timezone}
                  onChange={(event) =>
                    setFormData({ ...formData, timezone: event.target.value })
                  }
                  disabled={submitting}
                  className="mt-2 h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:border-[#0d47a1] focus:outline-none dark:bg-card dark:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  aria-invalid={Boolean(formErrors.timezone)}
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
                {formErrors.timezone ? (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.timezone}
                  </p>
                ) : null}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="deadline_offset_minutes">
                    Deadline Offset
                  </Label>
                  <div className="group relative">
                    <HelpCircle className="h-4 w-4 cursor-help text-muted-foreground" />
                    <div className="absolute bottom-full left-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 whitespace-normal rounded bg-slate-900 px-2 py-1 text-xs text-white group-hover:block">
                      Offset from task creation to deadline. Enter hours and
                      minutes (hours may be 0).
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Input
                      id="deadline_offset_hours"
                      type="number"
                      min="0"
                      value={deadlineOffsetHours}
                      onChange={(event) => {
                        const h = event.target.value.replace(/[^0-9]/g, "");
                        setDeadlineOffsetHours(h);
                        const total =
                          Number(h || 0) * 60 + Number(deadlineOffsetMins || 0);
                        setFormData({
                          ...formData,
                          deadline_offset_minutes: String(total),
                        });
                        setFormErrors((current) => ({
                          ...current,
                          deadline_offset_minutes: undefined,
                        }));
                      }}
                      disabled={submitting}
                      className="h-10 w-20 text-center font-medium"
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      h
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      id="deadline_offset_minutes"
                      type="number"
                      min="0"
                      max="59"
                      value={deadlineOffsetMins}
                      onChange={(event) => {
                        let m = event.target.value.replace(/[^0-9]/g, "");
                        if (m === "") m = "0";
                        let mm = Number(m);
                        if (mm > 59) mm = 59;
                        setDeadlineOffsetMins(String(mm));
                        const total =
                          Number(deadlineOffsetHours || 0) * 60 + mm;
                        setFormData({
                          ...formData,
                          deadline_offset_minutes: String(total),
                        });
                        setFormErrors((current) => ({
                          ...current,
                          deadline_offset_minutes: undefined,
                        }));
                      }}
                      disabled={submitting}
                      className="h-10 w-20 text-center font-medium"
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      m
                    </span>
                  </div>
                </div>
                {formErrors.deadline_offset_minutes ? (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.deadline_offset_minutes}
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <Label htmlFor="end_at">End At (optional)</Label>
              <Input
                id="end_at"
                type="datetime-local"
                value={formData.end_at}
                onChange={(event) => {
                  setFormData({ ...formData, end_at: event.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    end_at: undefined,
                  }));
                }}
                disabled={submitting}
                min={formData.start_at || deadlineMin}
                className="mt-2"
                aria-invalid={Boolean(formErrors.end_at)}
              />
              {formErrors.end_at ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.end_at}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={resetAndClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
