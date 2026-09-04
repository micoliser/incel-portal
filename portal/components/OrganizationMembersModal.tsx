"use client";

import { useEffect, useState, useRef } from "react";
import { Check, Loader2, ShieldAlert, X, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";

type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string | null;
  unit_id: string | null;
  team_id: string | null;
  department: string | null;
  unit_name: string | null;
  team_name: string | null;
};

type OrganizationMembersModalProps = {
  isOpen: boolean;
  onClose: () => void;
  entityType: "department" | "unit" | "team";
  entityId: string;
  entityName: string;
  parentEntityId: string | null;
  onSuccess: () => void;
  isAdmin?: boolean;
};

export function OrganizationMembersModal({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  parentEntityId,
  onSuccess,
  isAdmin = false,
}: OrganizationMembersModalProps) {
  const [mode, setMode] = useState<"view" | "add" | "remove">("view");
  const [members, setMembers] = useState<User[]>([]);
  const [candidates, setCandidates] = useState<User[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const isRequestInFlight = useRef(false);
  
  // Confirmation state
  const [isConfirming, setIsConfirming] = useState(false);
  const [overwriteUsers, setOverwriteUsers] = useState<User[]>([]);

  useEffect(() => {
    if (isOpen) {
      setMode("view");
      setIsConfirming(false);
      setSearch("");
      fetchMembers();
    }
  }, [isOpen, entityId]);

  useEffect(() => {
    if (!isOpen || mode === "view" || mode === "remove") return;
    
    const timeoutId = setTimeout(() => {
      fetchCandidates(search);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [search, mode]);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const resp = await apiClient.get("/admin/users", {
        params: { [`${entityType}_id`]: entityId }
      });
      setMembers(resp.data.results || resp.data);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load members."));
    } finally {
      setLoading(false);
    }
  };

  const fetchCandidates = async (searchQuery: string = "") => {
    if (isRequestInFlight.current) return;
    try {
      isRequestInFlight.current = true;
      setLoading(true);
      const params: Record<string, string | number> = { page_size: 50 };
      
      if (searchQuery) {
        params.q = searchQuery;
      }
      
      if (entityType === "department") {
        // Fetch all users for department
      } else if (entityType === "unit" && parentEntityId) {
        params.department_id = parentEntityId;
      } else if (entityType === "team" && parentEntityId) {
        params.unit_id = parentEntityId;
      }
      
      const resp = await apiClient.get("/admin/users", { params });
      let data: User[] = resp.data.results || resp.data;
      
      // Filter out users who are ALREADY exactly in this entity
      data = data.filter((u: User) => (u as Record<string, unknown>)[`${entityType}_id`] !== entityId);
      
      setCandidates(data);
      setCandidates(data);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load candidates."));
    } finally {
      setLoading(false);
      isRequestInFlight.current = false;
    }
  };

  const handleOpenAdd = () => {
    setSelectedUserIds(new Set());
    setMode("add");
    setSearch("");
    // fetchCandidates will be triggered by the useEffect
  };

  const handleOpenRemove = () => {
    setSelectedUserIds(new Set());
    setMode("remove");
  };
  
  const toggleSelection = (userId: number) => {
    const next = new Set(selectedUserIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setSelectedUserIds(next);
  };

  const submitAction = async (force: boolean = false) => {
    if (selectedUserIds.size === 0) return;
    
    // Check for overwrites if we are adding and not yet forced
    if (mode === "add" && !force) {
      const overwrites: User[] = [];
      candidates.forEach(user => {
        if (selectedUserIds.has(user.id)) {
          if (entityType === "department" && user.department_id) overwrites.push(user);
          if (entityType === "unit" && user.unit_id) overwrites.push(user);
          if (entityType === "team" && user.team_id) overwrites.push(user);
        }
      });
      
      if (overwrites.length > 0) {
        setOverwriteUsers(overwrites);
        setIsConfirming(true);
        return;
      }
    }

    try {
      setIsSubmitting(true);
      await apiClient.post(`/admin/organization/${entityType}s/${entityId}/bulk_members/`, {
        user_ids: Array.from(selectedUserIds),
        action: mode
      });
      toast.success(`Successfully ${mode === 'add' ? 'added' : 'removed'} members.`);
      setIsConfirming(false);
      onSuccess();
      
      // Refresh current view
      if (mode === "view" || mode === "remove") {
         fetchMembers();
         if (mode === "remove") setMode("view");
      } else {
         fetchMembers();
         setMode("view");
      }
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Action failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderViewMode = () => (
    <div className="space-y-4">
      {isAdmin && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenAdd}>
            Add Members
          </Button>
          {entityType !== "department" && (
            <Button variant="outline" size="sm" onClick={handleOpenRemove} disabled={members.length === 0}>
              Remove Members
            </Button>
          )}
        </div>
      )}
      
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
      ) : members.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm border rounded-md bg-muted/20">
          No members found in this {entityType}.
        </div>
      ) : (
        <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
          {members.map(user => (
            <div key={user.id} className="p-3 flex items-center justify-between hover:bg-muted/30">
              <div>
                <p className="font-medium text-sm">{user.first_name} {user.last_name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderSelectMode = () => {
    const list = mode === "add" ? candidates : members;
    return (
      <div className="space-y-4">
        {mode === "add" && (
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search users..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : list.length === 0 ? (
           <div className="text-center py-8 text-muted-foreground text-sm border rounded-md bg-muted/20">
            No eligible users found.
          </div>
        ) : (
          <div className="border rounded-md divide-y max-h-[300px] overflow-y-auto">
            {list.map(user => {
               const isSelected = selectedUserIds.has(user.id);
               return (
                 <div 
                   key={user.id} 
                   className={`p-3 flex items-center gap-3 cursor-pointer hover:bg-muted/30 ${isSelected ? 'bg-primary/5' : ''}`}
                   onClick={() => toggleSelection(user.id)}
                 >
                   <div className={`size-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                     {isSelected && <Check className="size-3" />}
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className="font-medium text-sm truncate">{user.first_name} {user.last_name}</p>
                     <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                   </div>
                   {mode === "add" && (
                     <div className="text-xs text-right">
                       {entityType === "team" && user.team_name && <span className="text-orange-500/80 block truncate max-w-[120px]">Team: {user.team_name}</span>}
                       {(entityType === "team" || entityType === "unit") && user.unit_name && <span className="text-emerald-500/80 block truncate max-w-[120px]">Unit: {user.unit_name}</span>}
                       {entityType === "department" && user.department && <span className="text-blue-500/80 block truncate max-w-[120px]">Dept: {user.department}</span>}
                     </div>
                   )}
                 </div>
               )
            })}
          </div>
        )}
        
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setMode("view")}>Cancel</Button>
          <Button 
            onClick={() => submitAction()} 
            disabled={selectedUserIds.size === 0 || isSubmitting}
            variant={mode === "remove" ? "destructive" : "default"}
          >
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {mode === "remove" ? "Remove Selected" : "Add Selected"}
          </Button>
        </div>
      </div>
    );
  };

  const renderConfirmMode = () => (
    <div className="space-y-4">
      <div className="p-4 rounded-md bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400">
        <div className="flex gap-2 items-start">
          <ShieldAlert className="size-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-sm">Warning: Reassignment</p>
            <p className="text-xs mt-1">The following users are already assigned to an existing {entityType}. Continuing will remove them from their current {entityType} and move them to <strong>{entityName}</strong>.</p>
          </div>
        </div>
      </div>
      
      <div className="border rounded-md divide-y max-h-[250px] overflow-y-auto">
        {overwriteUsers.map(user => (
          <div key={user.id} className="p-3 text-sm flex justify-between items-center">
            <span>{user.first_name} {user.last_name}</span>
            <span className="text-xs bg-muted px-2 py-1 rounded-md text-muted-foreground">
              {entityType === "department" ? user.department : entityType === "unit" ? user.unit_name : user.team_name}
            </span>
          </div>
        ))}
      </div>
      
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={() => setIsConfirming(false)}>Cancel</Button>
        <Button onClick={() => submitAction(true)} disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Confirm Move
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {isConfirming ? "Confirm Assignment" : mode === "view" ? `Members of ${entityName}` : mode === "add" ? `Add Members to ${entityName}` : `Remove Members from ${entityName}`}
          </DialogTitle>
          <DialogDescription>
            {isConfirming 
               ? "Please confirm you want to reassign these users." 
               : mode === "view" 
                 ? `Manage members inside this ${entityType}.` 
                 : mode === "add" 
                   ? `Select users to add.`
                   : `Select users to remove from this ${entityType}.`}
          </DialogDescription>
        </DialogHeader>

        {isConfirming ? renderConfirmMode() : mode === "view" ? renderViewMode() : renderSelectMode()}
      </DialogContent>
    </Dialog>
  );
}
