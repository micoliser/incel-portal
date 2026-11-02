"use client";

import { useState, useEffect } from "react";
import { Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { updateTask, type Task } from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  onTaskUpdated: (updatedTask: Task) => void;
}

function formatIsoToLocalInput(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function EditTaskModal({
  isOpen,
  onClose,
  task,
  onTaskUpdated,
}: EditTaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(task.priority);
  const [deadline, setDeadline] = useState(formatIsoToLocalInput(task.deadline));
  const [editReason, setEditReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTitle(task.title);
      setDescription(task.description || "");
      setPriority(task.priority);
      setDeadline(formatIsoToLocalInput(task.deadline));
      setEditReason("");
      setErrorMessage(null);
    }
  }, [isOpen, task]);

  const handleAddDays = (days: number) => {
    const baseDate = deadline ? new Date(deadline) : new Date();
    if (isNaN(baseDate.getTime())) return;
    const newDate = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
    setDeadline(formatIsoToLocalInput(newDate.toISOString()));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("Task title is required.");
      return;
    }

    let deadlineIso: string | null = null;
    if (deadline) {
      const parsed = new Date(deadline);
      if (isNaN(parsed.getTime())) {
        setErrorMessage("Please select a valid deadline date/time.");
        return;
      }
      if (parsed.getTime() < Date.now() - 60000) {
        setErrorMessage("Deadline cannot be in the past.");
        return;
      }
      deadlineIso = parsed.toISOString();
    } else {
      setErrorMessage("Deadline is required.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const updated = await updateTask(task.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
        deadline: deadlineIso,
        edit_reason: editReason.trim() || undefined,
      });

      toast.success("Task updated successfully");
      onTaskUpdated(updated);
      onClose();
    } catch (err) {
      const msg = extractApiErrorMessage(err, "Failed to update task.");
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Task Details</DialogTitle>
          <DialogDescription>
            Modify the task title, description, priority, or extend the deadline.
            All modifications will be recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {errorMessage && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-task-title">Title</Label>
            <Input
              id="edit-task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-task-description">Description</Label>
            <textarea
              id="edit-task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Task details and instructions"
              rows={3}
              disabled={isSubmitting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-task-priority">Priority</Label>
              <select
                id="edit-task-priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as "low" | "medium" | "high")
                }
                disabled={isSubmitting}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-task-deadline">Deadline</Label>
              <Input
                id="edit-task-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Quick extension shortcuts */}
          <div className="rounded-md border border-slate-200/80 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900/50">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Quick Deadline Extension:
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAddDays(1)}
                disabled={isSubmitting}
              >
                +1 Day
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAddDays(3)}
                disabled={isSubmitting}
              >
                +3 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleAddDays(7)}
                disabled={isSubmitting}
              >
                +1 Week
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-task-reason">
              Reason / Extension Note (Optional)
            </Label>
            <Input
              id="edit-task-reason"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. Extended deadline per assignee request"
              disabled={isSubmitting}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

