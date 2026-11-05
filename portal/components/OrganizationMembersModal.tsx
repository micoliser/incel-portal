"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Check, Loader2, ShieldAlert, Search, Users, UserMinus, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

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

function getInitials(firstName?: string, lastName?: string): string {
  const f = firstName?.trim() || "";
  const l = lastName?.trim() || "";
  if (!f && !l) return "U";
  return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase();
}

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

  const fetchMembers = useCallback(async () => {
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
  }, [entityType, entityId]);

  const fetchCandidates = useCallback(async (searchQuery: string = "") => {
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
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load candidates."));
    } finally {
      setLoading(false);
      isRequestInFlight.current = false;
    }
  }, [entityType, parentEntityId, entityId]);

  useEffect(() => {
    if (isOpen) {
      setMode("view");
      setIsConfirming(false);
      setSearch("");
      setSelectedUserIds(new Set());
      fetchMembers();
    }
  }, [isOpen, fetchMembers]);

  useEffect(() => {
    if (!isOpen || mode === "view" || mode === "remove") return;
    
    const timeoutId = setTimeout(() => {
      fetchCandidates(search);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [isOpen, search, mode, fetchCandidates]);

  const handleOpenTab = (nextMode: "view" | "add" | "remove") => {
    setSelectedUserIds(new Set());
    setSearch("");
    setIsConfirming(false);
    setMode(nextMode);
    if (nextMode === "view") {
      fetchMembers();
    } else if (nextMode === "add") {
      fetchCandidates("");
    }
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
      setSelectedUserIds(new Set());
      onSuccess();
      
      // Refresh current view
      await fetchMembers();
      setMode("view");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Action failed."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredMembers = members.filter((user) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const fullName = `${user.first_name} ${user.last_name}`.toLowerCase();
    return fullName.includes(q) || user.email.toLowerCase().includes(q);
  });

  const renderViewMode = () => (
    <div className="space-y-4">
      {members.length > 4 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search current members..."
            className="pl-8.5 h-9 rounded-lg text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      
      {loading ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin size-5 text-[#0d47a1] dark:text-[#38bdf8]" />
          <span>Loading members...</span>
        </div>
      ) : filteredMembers.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-xl bg-muted/20">
          <Users className="size-8 mx-auto mb-2 text-muted-foreground/60" />
          <p className="font-medium text-foreground">
            {search ? "No matching members found" : `No members assigned to this ${entityType}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {search ? "Try searching for a different name or email." : isAdmin ? "Use 'Add Members' above to assign personnel." : "Personnel will appear here once assigned."}
          </p>
        </div>
      ) : (
        <div className="border border-border/80 rounded-xl divide-y divide-border/60 max-h-[360px] overflow-y-auto">
          {filteredMembers.map((user) => (
            <div key={user.id} className="p-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="size-8 rounded-full bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] flex items-center justify-center text-xs font-bold shrink-0">
                  {getInitials(user.first_name, user.last_name)}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm text-foreground truncate">
                    {user.first_name} {user.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>

              <span className="text-[11px] font-medium rounded-md px-2 py-0.5 bg-muted text-muted-foreground shrink-0 capitalize">
                Member
              </span>
            </div>
          ))}
        </div>
      )}

      <DialogFooter className="pt-3 border-t border-border/60 sm:justify-between items-center flex-row">
        <span className="text-xs text-muted-foreground tabular-nums">
          {members.length} total member{members.length === 1 ? "" : "s"}
        </span>
        <Button variant="outline" size="sm" onClick={onClose} className="rounded-lg h-8">
          Done
        </Button>
      </DialogFooter>
    </div>
  );

  const renderSelectMode = () => {
    const list = mode === "add" ? candidates : members;
    return (
      <div className="space-y-4">
        {mode === "add" && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search candidate users..."
              className="pl-8.5 h-9 rounded-lg text-xs"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
            <Loader2 className="animate-spin size-5 text-[#0d47a1] dark:text-[#38bdf8]" />
            <span>Finding eligible users...</span>
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground text-sm border border-dashed rounded-xl bg-muted/20">
            <Users className="size-8 mx-auto mb-2 text-muted-foreground/60" />
            <p className="font-medium text-foreground">No eligible users found</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {mode === "add" ? "All active eligible personnel are already members." : "No members are currently in this entity to remove."}
            </p>
          </div>
        ) : (
          <div className="border border-border/80 rounded-xl divide-y divide-border/60 max-h-[320px] overflow-y-auto">
            {list.map(user => {
               const isSelected = selectedUserIds.has(user.id);
               return (
                 <div 
                   key={user.id} 
                   className={cn(
                     "p-3 flex items-center gap-3 cursor-pointer transition-colors",
                     isSelected ? "bg-[#0d47a1]/5 dark:bg-[#0d47a1]/15" : "hover:bg-muted/30"
                   )}
                   onClick={() => toggleSelection(user.id)}
                 >
                   <div className={cn(
                     "size-4.5 rounded-md border flex items-center justify-center shrink-0 transition-colors",
                     isSelected
                       ? "bg-[#0d47a1] border-[#0d47a1] text-white"
                       : "border-input bg-card"
                   )}>
                     {isSelected && <Check className="size-3" />}
                   </div>
                   
                   <div className="size-7.5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-xs font-bold shrink-0">
                     {getInitials(user.first_name, user.last_name)}
                   </div>

                   <div className="flex-1 min-w-0">
                     <p className="font-medium text-sm text-foreground truncate">
                       {user.first_name} {user.last_name}
                     </p>
                     <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                   </div>
                   
                   {mode === "add" && (
                     <div className="text-xs text-right shrink-0">
                       {entityType === "team" && user.team_name && (
                         <span className="text-amber-600 dark:text-amber-400 block truncate max-w-[130px] font-medium text-[11px]">
                           Team: {user.team_name}
                         </span>
                       )}
                       {(entityType === "team" || entityType === "unit") && user.unit_name && (
                         <span className="text-emerald-600 dark:text-emerald-400 block truncate max-w-[130px] font-medium text-[11px]">
                           Unit: {user.unit_name}
                         </span>
                       )}
                       {entityType === "department" && user.department && (
                         <span className="text-[#0d47a1] dark:text-[#38bdf8] block truncate max-w-[130px] font-medium text-[11px]">
                           Dept: {user.department}
                         </span>
                       )}
                     </div>
                   )}
                 </div>
               );
            })}
          </div>
        )}
        
        <DialogFooter className="pt-3 border-t border-border/60 sm:justify-between items-center flex-row">
          <span className="text-xs text-muted-foreground tabular-nums">
            {selectedUserIds.size} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenTab("view")} className="rounded-lg h-8">
              Back
            </Button>
            <Button 
              size="sm"
              onClick={() => submitAction()} 
              disabled={selectedUserIds.size === 0 || isSubmitting}
              variant={mode === "remove" ? "destructive" : "default"}
              className={cn(
                "rounded-lg h-8 font-medium shadow-xs",
                mode === "remove" ? "" : "bg-[#0d47a1] hover:bg-[#0a3880] text-white"
              )}
            >
              {isSubmitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {mode === "remove"
                ? `Remove (${selectedUserIds.size})`
                : `Add (${selectedUserIds.size})`}
            </Button>
          </div>
        </DialogFooter>
      </div>
    );
  };

  const renderConfirmMode = () => (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300">
        <div className="flex gap-2.5 items-start">
          <ShieldAlert className="size-5 shrink-0 text-amber-600 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-sm text-foreground">Reassignment Notice</p>
            <p className="leading-relaxed">
              The users below currently belong to another {entityType}. Continuing will automatically reassign them to <strong>{entityName}</strong>.
            </p>
          </div>
        </div>
      </div>
      
      <div className="border border-border/80 rounded-xl divide-y divide-border/60 max-h-[220px] overflow-y-auto">
        {overwriteUsers.map((user) => (
          <div key={user.id} className="p-3 text-sm flex justify-between items-center gap-3">
            <span className="font-medium truncate">{user.first_name} {user.last_name}</span>
            <span className="text-xs bg-muted px-2 py-0.5 rounded-md text-muted-foreground shrink-0">
              {entityType === "department" ? user.department : entityType === "unit" ? user.unit_name : user.team_name}
            </span>
          </div>
        ))}
      </div>
      
      <DialogFooter className="pt-3 border-t border-border/60 sm:justify-end gap-2.5">
        <Button variant="outline" size="sm" onClick={() => setIsConfirming(false)} className="rounded-lg h-8">
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => submitAction(true)}
          disabled={isSubmitting}
          className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm rounded-lg h-8"
        >
          {isSubmitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          Confirm Reassignment
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader icon={<Users className="size-4.5" />}>
          <DialogTitle>
            {isConfirming
              ? "Confirm Assignment"
              : mode === "view"
                ? `${entityName} Members`
                : mode === "add"
                  ? `Add Members to ${entityName}`
                  : `Remove Members from ${entityName}`}
          </DialogTitle>
          <DialogDescription>
            {isConfirming 
               ? "Review overlapping assignments before proceeding." 
               : mode === "view" 
                 ? `View and manage personnel assigned to this ${entityType}.` 
                 : mode === "add" 
                   ? `Select personnel to assign to this ${entityType}.`
                   : `Select members to remove from this ${entityType}.`}
          </DialogDescription>
        </DialogHeader>

        {/* Modal Tabs for Admin with Blue Active State */}
        {isAdmin && !isConfirming && (
          <div className="flex items-center gap-2 rounded-lg border border-border p-1 mb-2">
            <Button
              type="button"
              variant={mode === "view" ? "default" : "ghost"}
              onClick={() => handleOpenTab("view")}
              className={cn(
                "flex-1 rounded-md font-semibold text-xs transition-colors h-8 gap-1.5",
                mode === "view"
                  ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Users className="size-3.5" />
              Members
              <span className={cn(
                "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-medium",
                mode === "view" ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"
              )}>
                {members.length}
              </span>
            </Button>

            <Button
              type="button"
              variant={mode === "add" ? "default" : "ghost"}
              onClick={() => handleOpenTab("add")}
              className={cn(
                "flex-1 rounded-md font-semibold text-xs transition-colors h-8 gap-1.5",
                mode === "add"
                  ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UserPlus className="size-3.5" />
              Add
            </Button>

            {entityType !== "department" && (
              <Button
                type="button"
                variant={mode === "remove" ? "default" : "ghost"}
                onClick={() => handleOpenTab("remove")}
                disabled={members.length === 0}
                className={cn(
                  "flex-1 rounded-md font-semibold text-xs transition-colors h-8 gap-1.5 disabled:opacity-40",
                  mode === "remove"
                    ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <UserMinus className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        )}

        {isConfirming ? renderConfirmMode() : mode === "view" ? renderViewMode() : renderSelectMode()}
      </DialogContent>
    </Dialog>
  );
}
