"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, Plus, Paperclip, CheckCircle, Wrench, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { fetchMaintenanceLogs, MaintenanceLog } from "@/lib/api/inventory";
import { AddMaintenanceLogModal } from "@/components/inventory/AddMaintenanceLogModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function MaintenanceLogsPage() {
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [logToEdit, setLogToEdit] = useState<MaintenanceLog | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (statusFilter !== "all") params.status = statusFilter;
      
      const data = await fetchMaintenanceLogs(params);
      setLogs(data.results || data);
      setError(null);
    } catch (err) {
      const errorObj = err as { response?: { data?: { detail?: string } } };
      setError(errorObj?.response?.data?.detail || "Failed to load maintenance logs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case "in_progress": return <Wrench className="h-4 w-4 text-amber-500" />;
      default: return <AlertCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => { setLogToEdit(null); setIsModalOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Log
        </Button>
      </div>

      {error ? (
        <PageErrorCard title="Error" message={error} onRetry={loadLogs} />
      ) : (
        <Card className="overflow-hidden border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Issue Reported</th>
                  <th className="px-4 py-3 font-medium">Action Taken</th>
                  <th className="px-4 py-3 font-medium">Assigned To</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Attachments</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No maintenance logs found.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">{log.date}</td>
                      <td className="px-4 py-3 font-medium">
                        <Link href={`/inventory/${log.item.id}`} className="text-primary hover:underline">
                          {log.item.name} <span className="text-muted-foreground">({log.item.code})</span>
                        </Link>
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate" title={log.issue_reported}>
                        {log.issue_reported}
                      </td>
                      <td className="px-4 py-3 max-w-xs truncate" title={log.action_taken}>
                        {log.action_taken || "—"}
                      </td>
                      <td className="px-4 py-3">
                        {log.assigned_to ? `${log.assigned_to.first_name} ${log.assigned_to.last_name}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(log.status)}
                          <span className="capitalize">{log.status.replace("_", " ")}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {log.attachments && log.attachments.length > 0 ? (
                          <div className="space-y-1">
                            {log.attachments.map((att) => (
                              <a key={att.id} href={att.file_url || att.object_key} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1 text-xs">
                                <Paperclip className="h-3 w-3" /> {att.file_name}
                              </a>
                            ))}
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {log.status !== "completed" && (
                          <Button variant="outline" size="sm" onClick={() => { setLogToEdit(log); setIsModalOpen(true); }}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddMaintenanceLogModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setLogToEdit(null); }}
        onSuccess={loadLogs}
        editLog={logToEdit}
      />
    </div>
  );
}
