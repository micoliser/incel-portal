"use client";

import { useState, useEffect, useRef } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createTask, getUsers } from "@/lib/api/tasks";
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
}>;

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
    title: string;
    assigned_to_id: string;
    deadline: string;
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

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    assigned_to_id: "",
    priority: "medium",
    deadline: "",
  });

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
      await createTask({
        title: formData.title,
        description: formData.description,
        assigned_to_id: Number(formData.assigned_to_id),
        priority: formData.priority as "low" | "medium" | "high",
        deadline: formData.deadline || undefined,
      });
      toast.success("Task created successfully");
      setFormData({
        title: "",
        description: "",
        assigned_to_id: "",
        priority: "medium",
        deadline: "",
      });
      setAssigneeSearchInput("");
      setAssigneeSearchQuery("");
      setAssigneeHasTyped(false);
      setIsAssigneeDropdownOpen(false);
      setFormErrors({});
      onOpenChange(false);
      onTaskCreated();
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
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
            </div>

            <div className="flex gap-3 pt-2 border-t">
              <Button type="submit" disabled={submitting}>
                {submitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Create Task
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
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
