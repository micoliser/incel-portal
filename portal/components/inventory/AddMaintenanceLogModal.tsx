"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createMaintenanceLog, updateMaintenanceLog, getAttachmentUploadUrl, MaintenanceLog, MaintenanceLogAttachment } from "@/lib/api/inventory";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { UserCombobox } from "@/components/ui/user-combobox";
import { ItemCombobox } from "@/components/ui/item-combobox";

type AddMaintenanceLogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultItemId?: string;
  defaultItem?: { id: string, name: string, code: string } | null;
  editLog?: MaintenanceLog | null;
};

export function AddMaintenanceLogModal({
  isOpen,
  onClose,
  onSuccess,
  defaultItemId,
  defaultItem,
  editLog,
}: AddMaintenanceLogModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<MaintenanceLogAttachment[]>([]);
  
  const [form, setForm] = useState({
    item: defaultItemId || "",
    date: new Date().toISOString().split("T")[0],
    issue_reported: "",
    action_taken: "",
    status: "open",
    assigned_to: "",
  });

  useEffect(() => {
    if (!isOpen) return;
    
    if (editLog) {
      setForm({
        item: editLog.item.id,
        date: editLog.date,
        issue_reported: editLog.issue_reported,
        action_taken: editLog.action_taken || "",
        status: editLog.status,
        assigned_to: editLog.assigned_to ? String(editLog.assigned_to.id) : "",
      });
      setExistingAttachments(editLog.attachments || []);
    } else {
      setForm({
        item: defaultItemId || "",
        date: new Date().toISOString().split("T")[0],
        issue_reported: "",
        action_taken: "",
        status: "open",
        assigned_to: "",
      });
      setExistingAttachments([]);
    }
    setFiles([]);
  }, [isOpen, defaultItemId, editLog]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (e.target.files.length + existingAttachments.length > 5) {
        toast.error(`Maximum of 5 attachments allowed. You already have ${existingAttachments.length} existing.`);
        return;
      }
      setFiles(Array.from(e.target.files));
    } else {
      setFiles([]);
    }
  };

  const removeExistingAttachment = (idToRemove: string) => {
    setExistingAttachments((prev) => prev.filter((att) => att.id !== idToRemove));
  };

  const uploadFiles = async (): Promise<Array<{ object_key: string, file_name: string, content_type: string, size: number }>> => {
    if (files.length === 0) return [];
    
    try {
      setIsUploading(true);
      const uploadedAttachments = await Promise.all(
        files.map(async (file) => {
          const { upload_url, object_key } = await getAttachmentUploadUrl({
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
          });

          const res = await fetch(upload_url, {
            method: "PUT",
            body: file,
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
          });

          if (!res.ok) {
            throw new Error(`Failed to upload ${file.name}`);
          }

          return {
            object_key,
            file_name: file.name,
            content_type: file.type || "application/octet-stream",
            size: file.size,
          };
        })
      );
      return uploadedAttachments;
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.item || !form.issue_reported || !form.date) {
      return toast.error("Please fill out all required fields.");
    }

    try {
      setIsSubmitting(true);
      const uploadedAttachments = await uploadFiles();
      
      const formattedExistingAttachments = existingAttachments.map(att => ({
        object_key: att.object_key,
        file_name: att.file_name,
        content_type: att.content_type,
        size: att.size,
      }));

      const payload = {
        ...form,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
        attachments: [...formattedExistingAttachments, ...uploadedAttachments],
      };

      if (editLog) {
        await updateMaintenanceLog(editLog.id, payload);
        toast.success("Maintenance log updated successfully!");
      } else {
        await createMaintenanceLog(payload);
        toast.success("Maintenance log created successfully!");
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to create log"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{editLog ? "Edit Maintenance Log" : "Add Maintenance Log"}</DialogTitle>
          <DialogDescription>
            {editLog ? "Update details for this maintenance log." : "Record a new maintenance or repair issue for an asset."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="ml_item">Asset <span className="text-destructive">*</span></Label>
            <ItemCombobox
              value={form.item}
              onChange={(val) => setForm({ ...form, item: val })}
              disabled={!!defaultItemId || !!editLog}
              defaultItem={editLog ? editLog.item : defaultItem}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ml_date">Date <span className="text-destructive">*</span></Label>
            <Input
              id="ml_date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ml_issue">Issue Reported <span className="text-destructive">*</span></Label>
            <Textarea
              id="ml_issue"
              value={form.issue_reported}
              onChange={(e) => setForm({ ...form, issue_reported: e.target.value })}
              placeholder="Describe the issue with the asset..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ml_action">Action Taken</Label>
            <Textarea
              id="ml_action"
              value={form.action_taken}
              onChange={(e) => setForm({ ...form, action_taken: e.target.value })}
              placeholder="What was done to fix it? (Leave blank if pending)"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ml_status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(val) => setForm({ ...form, status: val })}
              >
                <SelectTrigger id="ml_status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ml_assignee">Assigned To</Label>
              <UserCombobox
                value={form.assigned_to}
                onChange={(val) => setForm({ ...form, assigned_to: val })}
                apiEndpoint="/users"
                defaultUser={editLog?.assigned_to ? { id: String(editLog.assigned_to.id), first_name: editLog.assigned_to.first_name, last_name: editLog.assigned_to.last_name } : null}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="log_attachment">Attachments (Max 5 total)</Label>
            
            {existingAttachments.length > 0 && (
              <div className="mb-2 space-y-1 bg-muted/50 p-2 rounded-md border border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Existing Attachments</p>
                {existingAttachments.map((att) => (
                  <div key={att.id} className="flex items-center justify-between text-sm bg-background p-1 px-2 rounded border border-border">
                    <span className="truncate max-w-[200px] text-xs">{att.file_name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                      onClick={() => removeExistingAttachment(att.id)}
                      disabled={isSubmitting || isUploading}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Input
              id="log_attachment"
              type="file"
              multiple
              onChange={handleFileChange}
              disabled={isSubmitting || isUploading || (existingAttachments.length >= 5)}
            />
            {files.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {files.length} new file(s) selected
              </p>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting || isUploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || isUploading}>
              {isSubmitting || isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {isUploading ? "Uploading..." : editLog ? "Save Changes" : "Save Log"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
