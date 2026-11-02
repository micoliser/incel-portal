"use client";

import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { rejectTask, type Task } from "@/lib/api/tasks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RejectTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  onTaskRejected: (updatedTask: Task) => void;
}

export function RejectTaskModal({
  isOpen,
  onClose,
  task,
  onTaskRejected,
}: RejectTaskModalProps) {
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMessage("Please provide a reason or revision instructions.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const updated = await rejectTask(task.id, reason.trim());
      toast.success("Task returned to In Progress with your feedback");
      onTaskRejected(updated);
      onClose();
    } catch (err) {
      const msg = extractApiErrorMessage(err, "Failed to reject task.");
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangle className="h-5 w-5" /> Request Revisions
          </DialogTitle>
          <DialogDescription>
            The task will be returned to <strong>In Progress</strong> for{" "}
            <strong>{task.assigned_to.full_name}</strong>. Please explain what
            needs to be revised.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {errorMessage && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="reject-task-reason">Feedback / Revision Notes</Label>
            <textarea
              id="reject-task-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Please update the summary section and attach the latest revised spreadsheet."
              rows={4}
              required
              disabled={isSubmitting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={isSubmitting}
            >
              {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send Back for Revision
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

