"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { UserCombobox } from "@/components/ui/user-combobox";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";

type AssignLeaderModalProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: "department" | "unit" | "team";
  entityId: string;
  entityName: string;
  currentLeaderId?: string | number | null;
  onSuccess: () => void;
};

export function AssignLeaderModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  currentLeaderId,
  onSuccess,
}: AssignLeaderModalProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedUserId(currentLeaderId ? String(currentLeaderId) : "");
    }
  }, [isOpen, currentLeaderId]);

  const leaderField = 
    entityType === "department" ? "line_manager" :
    entityType === "unit" ? "supervisor" : "team_lead";
    
  const leaderLabel = 
    entityType === "department" ? "Line Manager" :
    entityType === "unit" ? "Supervisor" : "Team Lead";

  const submitAction = async () => {
    try {
      setIsSubmitting(true);
      await apiClient.patch(`/admin/organization/${entityType}s/${entityId}/`, {
        [leaderField]: selectedUserId || null
      });
      toast.success(`Successfully assigned ${leaderLabel.toLowerCase()}.`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Action failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Assign {leaderLabel}</DialogTitle>
          <DialogDescription>
            Select a user to lead <strong>{entityName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{leaderLabel}</Label>
            <UserCombobox
              value={selectedUserId}
              onChange={(val) => setSelectedUserId(val)}
              apiEndpoint="/admin/users"
              additionalParams={{ [`${entityType}_id`]: entityId }}
              placeholder={`Search for a ${leaderLabel.toLowerCase()}...`}
            />
          </div>
        </div>
        
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submitAction} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
