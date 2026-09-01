"use client";

import { useEffect, useState, useCallback } from "react";
import { format } from "date-fns";
import { Loader2, Plus, Paperclip, CheckCircle, Wrench, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchMaintenanceLogs, MaintenanceLog } from "@/lib/api/inventory";
import { AddMaintenanceLogModal } from "@/components/inventory/AddMaintenanceLogModal";

export function MaintenanceLogsList({ itemId, item }: { itemId: string, item?: { id: string, name: string, code: string } }) {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [logToEdit, setLogToEdit] = useState<MaintenanceLog | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchMaintenanceLogs({ item: itemId });
      setLogs(data.results || data);
      setError(null);
    } catch (err) {
      const errorObj = err as { response?: { status?: number; data?: { detail?: string } } };
      if (errorObj?.response?.status === 403) {
        setError("forbidden");
      } else {
        setError(errorObj?.response?.data?.detail || "Failed to load maintenance logs");
      }
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-emerald-500 inline-block mr-1" />;
      case "in_progress": return <Wrench className="h-4 w-4 text-amber-500 inline-block mr-1" />;
      default: return <AlertCircle className="h-4 w-4 text-blue-500 inline-block mr-1" />;
    }
  };

  if (error === "forbidden") {
    // Silently hide the section for users without permissions
    return null;
  }

  return (
    <Card className="p-6 border border-border mt-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">Maintenance History</h2>
        <Button size="sm" onClick={() => { setLogToEdit(null); setIsModalOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Log
        </Button>
      </div>

      {loading ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-destructive text-sm bg-destructive/10 p-3 rounded">{error}</div>
      ) : logs.length === 0 ? (
        <p className="text-muted-foreground text-sm">No maintenance history found for this item.</p>
      ) : (
        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.id} className="border-b border-border pb-6 last:border-0 last:pb-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Status</p>
                  <p className="font-medium text-foreground flex items-center">
                    {getStatusIcon(log.status)}
                    <span className="capitalize">{log.status.replace("_", " ")}</span>
                  </p>
                </div>
                <div className="space-y-1 sm:text-right">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Date Logged</p>
                  <p className="text-sm font-medium text-foreground">
                    {format(new Date(log.date), "MMM d, yyyy")}
                  </p>
                </div>
                
                <div className="space-y-1 sm:col-span-2">
                  <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Issue Reported</p>
                  <p className="text-sm text-foreground">{log.issue_reported}</p>
                </div>

                {log.action_taken && (
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Action Taken</p>
                    <div className="text-sm text-foreground bg-muted/30 rounded-md p-3 border-l-2 border-primary">
                      {log.action_taken}
                    </div>
                  </div>
                )}

                {log.assigned_to && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Assigned To</p>
                    <p className="text-sm text-foreground">
                      {log.assigned_to.first_name} {log.assigned_to.last_name}
                    </p>
                  </div>
                )}

                {log.attachments && log.attachments.length > 0 && (
                  <div className="space-y-1 sm:col-span-2 mt-1">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Attachments</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {log.attachments.map((attachment) => (
                        <a key={attachment.id} href={attachment.file_url || attachment.object_key} target="_blank" rel="noopener noreferrer" className="bg-muted px-2 py-1 rounded-md text-blue-600 hover:text-blue-800 hover:bg-muted/80 text-xs flex items-center gap-1 transition-colors border border-border">
                          <Paperclip className="h-3 w-3" /> {attachment.file_name}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {log.status !== "completed" && (
                <div className="mt-4 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setLogToEdit(log); setIsModalOpen(true); }}>
                    Edit Log
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AddMaintenanceLogModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setLogToEdit(null);
        }}
        onSuccess={loadLogs}
        defaultItemId={itemId}
        defaultItem={item}
        editLog={logToEdit}
      />
    </Card>
  );
}
