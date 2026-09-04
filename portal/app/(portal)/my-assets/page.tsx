"use client";
import { extractApiErrorMessage } from "@/lib/api-errors";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Package } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { MyAssetsSkeleton } from "@/components/skeletons/my-assets-skeleton";

type InventoryCategory = {
  id: string;
  name: string;
  description: string;
};

type InventoryAssignment = {
  id: string;
  assigned_to: { id: string | number; first_name?: string; last_name?: string; email?: string; full_name?: string } | null;
  assigned_by: { id: string | number; first_name?: string; last_name?: string; email?: string; full_name?: string } | null;
  assigned_at: string;
  returned_at: string | null;
  condition_notes: string;
};

type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: InventoryCategory;
  serial_number: string;
  purchase_date: string | null;
  status: string;
  notes: string;
  assignments: InventoryAssignment[];
};

export default function MyAssetsPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMyAssets() {
      try {
        setLoading(true);
        const response = await apiClient.get("/me/inventory/");
        setItems(response.data as InventoryItem[]);
        setError(null);
      } catch (err) {
                setError(extractApiErrorMessage(err, "Failed to load your assets."));
      } finally {
        setLoading(false);
      }
    }
    fetchMyAssets();
  }, []);

  if (loading) {
    return <MyAssetsSkeleton />;
  }

  if (error) {
    return (
      <PageErrorCard
        title="Failed to load assets"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-8">
      {items.length === 0 ? (
        <div className="flex min-h-[30vh] items-center justify-center rounded-xl border border-dashed p-8 text-center">
          <div className="space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Package className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">No Assets Assigned</h3>
            <p className="text-sm text-muted-foreground">
              You do not have any items assigned to you at the moment.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => {
            const currentAssignment = item.assignments.find((a) => !a.returned_at);
            return (
              <Card key={item.id} className="flex flex-col justify-between p-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {item.category.name} {item.serial_number ? `• SN: ${item.serial_number}` : ""}
                    </p>
                  </div>
                  
                  {currentAssignment && (
                    <div className="rounded-md bg-muted/50 p-3 text-sm">
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Assignment Details
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="text-muted-foreground">Assigned:</div>
                        <div className="font-medium text-right">
                          {format(new Date(currentAssignment.assigned_at), "MMM d, yyyy")}
                        </div>
                        <div className="text-muted-foreground">Assigned By:</div>
                        <div className="font-medium text-right">
                          {currentAssignment.assigned_by?.first_name} {currentAssignment.assigned_by?.last_name}
                        </div>
                      </div>
                    </div>
                  )}

                  {item.notes && (
                    <div className="text-sm">
                      <span className="font-semibold text-muted-foreground">Notes: </span>
                      {item.notes}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
