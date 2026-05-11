"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, Loader2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { createRecurringSchedule, createTask, getUsers } from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type User = Awaited<ReturnType<typeof getUsers>>[number];

type FormErrors = Partial<{
  title: string;
  assigned_to_id: string;
  deadline: string;
  mode: string;
  frequency: string;
  interval: string;
  weekdays: string;
  times: string;
  timezone: string;
  start_at: string;
  end_at: string;
  deadline_offset_minutes: string;
}>;

type CreateMode = "one_time" | "recurring";

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

const initialForm = {
  mode: "one_time" as CreateMode,
  title: "",
  description: "",
  assigned_to_id: "",
  priority: "medium",
  deadline: "",
  frequency: "daily",
  interval: "1",
  weekdays: [] as number[],
  times: ["09:00"],
  timezone: "Asia/Dubai",
  start_at: "",
  end_at: "",
  deadline_offset_minutes: "0",
};

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

function validateForm(
  formData: {
    mode: CreateMode;
    title: string;
    description: string;
    assigned_to_id: string;
    deadline: string;
    priority: string;
    frequency: string;
    interval: string;
    weekdays: number[];
    times: string[];
    timezone: string;
    start_at: string;
    end_at: string;
    deadline_offset_minutes: string;
  },
  deadlineMin: string,
): FormErrors {
  const errors: FormErrors = {};

  if (!formData.title.trim()) {
    errors.title = "Task title is required.";
  }

  if (!formData.assigned_to_id) {
    errors.assigned_to_id = "Please select a user to assign this task to.";
  }

  if (formData.mode === "one_time") {
    if (!formData.deadline) {
      errors.deadline = "Deadline is required.";
    }

    if (formData.deadline) {
      const selectedDeadline = new Date(formData.deadline);
      const minimumDeadline = new Date(deadlineMin);

      if (selectedDeadline < minimumDeadline) {
        errors.deadline = "Deadline cannot be in the past.";
      }
    }
    return errors;
  }

  if (!formData.start_at) {
    errors.start_at = "Start date is required.";
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

interface CreateTaskModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskCreated: () => void;
  currentUserId?: number | null;
}

export function CreateTaskModal({
  open,
  onOpenChange,
  onTaskCreated,
  currentUserId,
}: CreateTaskModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [assigneeSearchInput, setAssigneeSearchInput] = useState("");
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState("");
  const [assigneeHasTyped, setAssigneeHasTyped] = useState(false);
  const [isAssigneeDropdownOpen, setIsAssigneeDropdownOpen] = useState(false);
  const assigneeDropdownRef = useRef<HTMLDivElement | null>(null);
  const deadlineMin = getDatetimeLocalMin();

  const [formData, setFormData] = useState(initialForm);

  const resetForm = () => {
    setFormData({ ...initialForm });
    setFormErrors({});
    setApiError(null);
    setAssigneeSearchInput("");
    setAssigneeSearchQuery("");
    setAssigneeHasTyped(false);
    setIsAssigneeDropdownOpen(false);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAssigneeSearchQuery(
        assigneeHasTyped ? assigneeSearchInput.trim() : "",
      );
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [assigneeSearchInput, assigneeHasTyped]);

  useEffect(() => {
    if (!open) return;

    const fetchUsers = async () => {
      try {
        const isFirstLoad = assigneeSearchQuery === "" && users.length === 0;
        if (isFirstLoad) {
          setInitialLoading(true);
        } else {
          setIsLoadingUsers(true);
        }
        const data = await getUsers({
          search: assigneeSearchQuery || undefined,
        });
        const selectableUsers =
          currentUserId == null
            ? data
            : data.filter((user) => user.id !== currentUserId);
        setUsers(selectableUsers);
        setApiError(null);
      } catch {
        const message = "Failed to load users";
        toast.error(message);
        setApiError(message);
      } finally {
        setInitialLoading(false);
        setIsLoadingUsers(false);
      }
    };

    fetchUsers();
  }, [open, assigneeSearchQuery, currentUserId, users.length]);

  useEffect(() => {
    if (!isAssigneeDropdownOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAssigneeDropdownOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isAssigneeDropdownOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);

    const validationErrors = validateForm(formData, deadlineMin);
    setFormErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    try {
      setSubmitting(true);
      if (formData.mode === "recurring") {
        await createRecurringSchedule({
          title: formData.title,
          description: formData.description,
          assigned_to_id: Number(formData.assigned_to_id),
          priority: formData.priority as "low" | "medium" | "high",
          frequency: formData.frequency as "daily" | "weekly",
          interval: Number(formData.interval),
          weekdays: formData.weekdays,
          times: formData.times,
          timezone: formData.timezone,
          deadline_offset_minutes: Number(
            formData.deadline_offset_minutes || 0,
          ),
          start_at: new Date(formData.start_at).toISOString(),
          end_at: formData.end_at
            ? new Date(formData.end_at).toISOString()
            : null,
        });
        toast.success("Recurring task schedule created successfully");
      } else {
        await createTask({
          title: formData.title,
          description: formData.description,
          assigned_to_id: Number(formData.assigned_to_id),
          priority: formData.priority as "low" | "medium" | "high",
          deadline: formData.deadline || undefined,
        });
        toast.success("Task created successfully");
      }
      setFormData({
        ...initialForm,
      });
      resetForm();
      onOpenChange(false);
      onTaskCreated();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetForm();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
          <DialogDescription>
            Assign a new task to a team member
          </DialogDescription>
        </DialogHeader>

        {apiError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-800">{apiError}</div>
          </div>
        )}

        {initialLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <div className="flex items-center gap-2 rounded-lg border border-border p-1 dark:border-slate-700 mb-6">
                <Button
                  type="button"
                  variant={formData.mode === "one_time" ? "default" : "ghost"}
                  className="flex-1 rounded-md"
                  onClick={() =>
                    setFormData((current) => ({ ...current, mode: "one_time" }))
                  }
                >
                  One-time Task
                </Button>
                <Button
                  type="button"
                  variant={formData.mode === "recurring" ? "default" : "ghost"}
                  className="flex-1 rounded-md"
                  onClick={() =>
                    setFormData((current) => ({
                      ...current,
                      mode: "recurring",
                    }))
                  }
                >
                  Recurring Task
                </Button>
              </div>

              <Label htmlFor="title">Task Title *</Label>
              <Input
                id="title"
                type="text"
                placeholder="Enter task title"
                value={formData.title}
                onChange={(e) => {
                  setFormData({ ...formData, title: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    title: undefined,
                  }));
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
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                disabled={submitting}
                className="mt-2 min-h-20 w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-gray-900 dark:text-white"
              />
            </div>

            <div>
              <Label htmlFor="assigned_to">Assign To *</Label>
              <div className="relative mt-2" ref={assigneeDropdownRef}>
                <Input
                  id="assigned_to"
                  type="text"
                  placeholder="Select or search assignee"
                  value={assigneeSearchInput}
                  onFocus={() => {
                    setAssigneeHasTyped(false);
                    setIsAssigneeDropdownOpen(true);
                  }}
                  onClick={() => {
                    setAssigneeHasTyped(false);
                    setIsAssigneeDropdownOpen(true);
                  }}
                  onChange={(e) => {
                    setAssigneeSearchInput(e.target.value);
                    setAssigneeHasTyped(true);
                    setFormData({ ...formData, assigned_to_id: "" });
                    setFormErrors((current) => ({
                      ...current,
                      assigned_to_id: undefined,
                    }));
                    setIsAssigneeDropdownOpen(true);
                  }}
                  disabled={submitting}
                  autoComplete="off"
                  aria-invalid={Boolean(formErrors.assigned_to_id)}
                />

                {isAssigneeDropdownOpen && (
                  <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                    {isLoadingUsers ? (
                      <div className="flex items-center justify-center px-3 py-3">
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                      </div>
                    ) : users.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                        No users found
                      </div>
                    ) : (
                      users.map((user) => {
                        const fullName = [user.first_name, user.last_name]
                          .filter(Boolean)
                          .join(" ")
                          .trim();
                        const label = fullName
                          ? `${fullName} (${user.email})`
                          : user.email;

                        return (
                          <button
                            key={user.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFormData({
                                ...formData,
                                assigned_to_id: String(user.id),
                              });
                              setAssigneeSearchInput(label);
                              setAssigneeHasTyped(false);
                              setIsAssigneeDropdownOpen(false);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            {label}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              {formErrors.assigned_to_id ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.assigned_to_id}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData({ ...formData, priority: e.target.value })
                  }
                  disabled={submitting}
                  className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-gray-900 dark:text-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>

              {formData.mode === "one_time" ? (
                <div>
                  <Label htmlFor="deadline">Deadline</Label>
                  <Input
                    id="deadline"
                    type="datetime-local"
                    value={formData.deadline}
                    onChange={(e) => {
                      setFormData({ ...formData, deadline: e.target.value });
                      setFormErrors((current) => ({
                        ...current,
                        deadline: undefined,
                      }));
                    }}
                    disabled={submitting}
                    min={deadlineMin}
                    className="mt-2"
                    aria-invalid={Boolean(formErrors.deadline)}
                  />
                  {formErrors.deadline ? (
                    <p className="mt-1 text-xs text-destructive">
                      {formErrors.deadline}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div>
                  <Label htmlFor="start_at">Start At</Label>
                  <Input
                    id="start_at"
                    type="datetime-local"
                    value={formData.start_at}
                    onChange={(e) => {
                      setFormData({ ...formData, start_at: e.target.value });
                      setFormErrors((current) => ({
                        ...current,
                        start_at: undefined,
                      }));
                    }}
                    disabled={submitting}
                    min={deadlineMin}
                    className="mt-2"
                    aria-invalid={Boolean(formErrors.start_at)}
                  />
                  {formErrors.start_at ? (
                    <p className="mt-1 text-xs text-destructive">
                      {formErrors.start_at}
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {formData.mode === "recurring" ? (
              <div className="space-y-4 rounded-lg border border-border p-4 dark:border-slate-700">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <Label htmlFor="frequency">Frequency</Label>
                    <select
                      id="frequency"
                      value={formData.frequency}
                      onChange={(e) =>
                        setFormData({ ...formData, frequency: e.target.value })
                      }
                      disabled={submitting}
                      className="mt-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:bg-gray-900 dark:text-white"
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
                      Every N{" "}
                      {formData.frequency === "weekly" ? "weeks" : "days"}
                    </Label>
                    <Input
                      id="interval"
                      type="number"
                      min="1"
                      value={formData.interval}
                      onChange={(e) => {
                        setFormData({ ...formData, interval: e.target.value });
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

                {formData.frequency === "weekly" ? (
                  <div>
                    <Label>Weekdays</Label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WEEKDAY_OPTIONS.map((weekday) => {
                        const checked = formData.weekdays.includes(
                          weekday.value,
                        );
                        return (
                          <Button
                            key={weekday.value}
                            type="button"
                            variant={checked ? "default" : "outline"}
                            className="h-9 rounded-full px-3 text-xs"
                            onClick={() => {
                              setFormData((current) => ({
                                ...current,
                                weekdays: current.weekdays.includes(
                                  weekday.value,
                                )
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
                          onChange={(e) => {
                            const nextTimes = [...formData.times];
                            nextTimes[index] = e.target.value;
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
                      onChange={(e) =>
                        setFormData({ ...formData, timezone: e.target.value })
                      }
                      disabled={submitting}
                      className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
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
                        Deadline Offset (minutes)
                      </Label>
                      <div className="group relative">
                        <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-slate-900 text-white text-xs rounded px-2 py-1 w-max whitespace-normal z-10">
                          Minutes added to task creation time to set the
                          deadline. For example, 480 minutes (8 hours) means
                          tasks created at 9 AM will be due at 5 PM.
                        </div>
                      </div>
                    </div>
                    <Input
                      id="deadline_offset_minutes"
                      type="number"
                      min="0"
                      value={formData.deadline_offset_minutes}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          deadline_offset_minutes: e.target.value,
                        })
                      }
                      disabled={submitting}
                      className="mt-2"
                      aria-invalid={Boolean(formErrors.deadline_offset_minutes)}
                    />
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
                    onChange={(e) => {
                      setFormData({ ...formData, end_at: e.target.value });
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
            ) : null}

            <div className="flex gap-3 pt-2 border-t">
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {formData.mode === "recurring"
                  ? "Create Schedule"
                  : "Create Task"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  resetForm();
                  onOpenChange(false);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
