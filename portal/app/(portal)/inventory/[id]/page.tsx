"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { UserCombobox } from "@/components/ui/user-combobox";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { InventoryDetailSkeleton } from "@/components/skeletons/inventory-detail-skeleton";
import { MaintenanceLogsList } from "@/components/inventory/MaintenanceLogsList";

type UserOption = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type InventoryAssignment = {
  id: string;
  assigned_to: UserOption;
  assigned_by: UserOption;
  assigned_at: string;
  returned_at: string | null;
  condition_notes: string;
};

type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: { id: string; name: string };
  serial_number: string;
  purchase_date: string | null;
  status: string;
  notes: string;
  photo_url?: string;
  current_assignee: UserOption | null;
  assignments: InventoryAssignment[];
};

const statusColors: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800",
  assigned: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  retired: "bg-gray-100 text-gray-800",
};

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

export default function InventoryItemDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  
  const [item, setItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [assignForm, setAssignForm] = useState({ assigned_to: "", condition_notes: "" });
  const [returnForm, setReturnForm] = useState({ condition_notes: "" });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const itemRes = await apiClient.get(`/inventory/items/${id}/`);
      setItem(itemRes.data);
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load item details."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (id) fetchData();
  }, [id, fetchData]);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.assigned_to) return toast.error("Please select a user");

    try {
      setIsSubmitting(true);
      await apiClient.post(`/inventory/items/${id}/assign/`, assignForm);
      toast.success("Item assigned successfully");
      setIsAssignOpen(false);
      setAssignForm({ assigned_to: "", condition_notes: "" });
      fetchData();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to assign item"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturn = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsSubmitting(true);
      await apiClient.post(`/inventory/items/${id}/return_item/`, returnForm);
      toast.success("Item returned successfully");
      setIsReturnOpen(false);
      setReturnForm({ condition_notes: "" });
      fetchData();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to return item"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <InventoryDetailSkeleton />;
  }

  if (error || !item) {
    return <PageErrorCard title="Error" message={error || "Not found"} onRetry={() => router.back()} />;
  }

  return (
    <div className="space-y-8">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.back()}
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Inventory
      </Button>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            {item.photo_url && (
              <Dialog>
                <DialogTrigger asChild>
                  <div className="relative w-16 h-16 shrink-0 cursor-pointer">
                    <Image
                      src={item.photo_url}
                      alt={item.name}
                      className="rounded-lg object-cover shadow-sm border border-border"
                      fill
                      unoptimized
                    />
                  </div>
                </DialogTrigger>
                <DialogContent className="sm:max-w-2xl p-0 border-none bg-transparent shadow-none">
                  <DialogTitle className="sr-only">Photo of {item.name}</DialogTitle>
                  <div className="relative w-full h-[80vh]">
                    <Image
                      src={item.photo_url}
                      alt={item.name}
                      className="object-contain rounded-lg"
                      fill
                      unoptimized
                    />
                  </div>
                </DialogContent>
              </Dialog>
            )}
            <div>
              <h1 className="text-3xl font-bold">
                {item.name} <span className="text-muted-foreground text-2xl font-normal">({item.code})</span>
              </h1>
              <p className="text-gray-600 mt-2">Asset Details</p>
            </div>
          </div>
          <span
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${statusColors[item.status]}`}
          >
            {item.status.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="p-6 md:col-span-1 border border-border h-fit">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Category</div>
              <div className="font-medium mt-1">{item.category.name}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Serial Number</div>
              <div className="font-mono mt-1">{item.serial_number || "—"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Current Assignee</div>
              <div className="font-medium mt-1">
                {item.current_assignee 
                  ? `${item.current_assignee.first_name} ${item.current_assignee.last_name}` 
                  : "None"}
              </div>
            </div>
            {item.notes && (
              <div>
                <div className="text-sm font-medium text-muted-foreground">Notes</div>
                <div className="text-sm mt-1">{item.notes}</div>
              </div>
            )}
            
            <div className="pt-4 border-t border-border flex flex-col gap-2">
              {item.status !== "assigned" && (
                <Button onClick={() => setIsAssignOpen(true)} className="w-full">
                  Assign Item
                </Button>
              )}
              {item.status === "assigned" && (
                <Button onClick={() => setIsReturnOpen(true)} variant="outline" className="w-full border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/50 dark:border-amber-900/50 dark:text-amber-500">
                  Return Item
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="p-6 md:col-span-2 border border-border">
          <h2 className="text-lg font-bold mb-4">Assignment History</h2>
          {item.assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No assignment history found for this item.</p>
          ) : (
            <div className="space-y-4">
              {item.assignments.map((assignment) => (
                <div key={assignment.id} className="border-b border-border pb-4 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">
                        Assigned to {assignment.assigned_to?.first_name} {assignment.assigned_to?.last_name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        By {assignment.assigned_by?.first_name} {assignment.assigned_by?.last_name} on {format(new Date(assignment.assigned_at), "MMM d, yyyy")}
                      </p>
                    </div>
                    {assignment.returned_at ? (
                      <div className="text-right">
                        <span className="inline-block bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-full dark:bg-gray-800 dark:text-gray-300">
                          Returned
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(assignment.returned_at), "MMM d, yyyy")}
                        </p>
                      </div>
                    ) : (
                      <span className="inline-block bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full dark:bg-blue-900/30 dark:text-blue-400">
                        Active
                      </span>
                    )}
                  </div>
                  {assignment.condition_notes && (
                    <div className="mt-2 bg-muted/50 p-2 rounded text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">Notes:</span> {assignment.condition_notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <MaintenanceLogsList itemId={id} item={item} />

      {/* Assign Modal */}
      <Dialog open={isAssignOpen} onOpenChange={setIsAssignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Item</DialogTitle>
            <DialogDescription>Assign {item.name} to a user.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="assign_user">Select User</Label>
              <UserCombobox
                value={assignForm.assigned_to}
                onChange={(value) => setAssignForm({ ...assignForm, assigned_to: value })}
                apiEndpoint="/admin/users"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assign_notes">Condition Notes (Optional)</Label>
              <Input
                id="assign_notes"
                value={assignForm.condition_notes}
                onChange={(e) => setAssignForm({ ...assignForm, condition_notes: e.target.value })}
                placeholder="e.g. Minor scratch on lid"
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Assign
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Return Modal */}
      <Dialog open={isReturnOpen} onOpenChange={setIsReturnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return Item</DialogTitle>
            <DialogDescription>Mark {item.name} as returned and available.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleReturn} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="return_notes">Condition Notes (Optional)</Label>
              <Input
                id="return_notes"
                value={returnForm.condition_notes}
                onChange={(e) => setReturnForm({ ...returnForm, condition_notes: e.target.value })}
                placeholder="e.g. Screen cracked, needs repair"
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Process Return
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
