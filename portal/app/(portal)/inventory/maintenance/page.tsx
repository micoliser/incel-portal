"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Paperclip, CheckCircle, Wrench, AlertCircle, Search, ArrowLeft, X, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api-client";
import { PageErrorCard } from "@/components/page-error-card";
import { fetchMaintenanceLogs, exportMaintenanceLogs, MaintenanceLog } from "@/lib/api/inventory";
import { AddMaintenanceLogModal } from "@/components/inventory/AddMaintenanceLogModal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type InventoryCategory = {
  id: string;
  name: string;
  description: string;
};

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

export default function MaintenanceLogsPage() {
  const router = useRouter();
  const [logs, setLogs] = useState<MaintenanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [logToEdit, setLogToEdit] = useState<MaintenanceLog | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const isRequestInFlightRef = useRef(false);
  const loadMoreRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setCurrentPage(1);
    setLogs([]);
  }, [statusFilter, categoryFilter, debouncedSearch]);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await apiClient.get("/inventory/categories/");
        setCategories(response.data.results || response.data);
      } catch (err) {
        console.error("Failed to load categories", err);
      }
    };
    loadCategories();
  }, []);

  const loadLogs = useCallback(async () => {
    if (isRequestInFlightRef.current) return;

    try {
      isRequestInFlightRef.current = true;
      if (currentPage === 1) {
        setLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      
      const params: Record<string, string | number> = { page: currentPage };
      if (statusFilter !== "all") params.status = statusFilter;
      if (categoryFilter !== "all") params.category = categoryFilter;
      if (debouncedSearch) params.q = debouncedSearch;
      
      const payload = await fetchMaintenanceLogs(params);
      
      let results: MaintenanceLog[] = [];
      if (Array.isArray(payload)) {
        results = payload;
      } else if (payload && typeof payload === "object") {
        const typedPayload = payload as { results?: MaintenanceLog[] };
        results = Array.isArray(typedPayload.results) ? typedPayload.results : [];
      }

      setLogs((current) => (currentPage === 1 ? results : [...current, ...results]));
      
      const hasNext = !Array.isArray(payload) && payload && typeof payload === "object"
        ? Boolean((payload as { next_page?: unknown }).next_page)
        : false;
      
      setHasNextPage(hasNext);
      setError(null);
    } catch (err) {
      const errorObj = err as { response?: { data?: { detail?: string } } };
      setError(errorObj?.response?.data?.detail || "Failed to load maintenance logs");
    } finally {
      isRequestInFlightRef.current = false;
      setLoading(false);
      setIsLoadingMore(false);
    }
  }, [statusFilter, categoryFilter, debouncedSearch, currentPage]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !loading && !isLoadingMore) {
          setCurrentPage((page) => page + 1);
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, loading, isLoadingMore]);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const params: Record<string, string> = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (categoryFilter !== "all") params.category = categoryFilter;
      if (debouncedSearch) params.q = debouncedSearch;
      
      const blob = await exportMaintenanceLogs(params);
      const url = window.URL.createObjectURL(new Blob([blob]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "maintenance_logs.csv");
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Failed to export maintenance logs");
    } finally {
      setIsExporting(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed": return <CheckCircle className="h-4 w-4 text-emerald-500" />;
      case "in_progress": return <Wrench className="h-4 w-4 text-amber-500" />;
      default: return <AlertCircle className="h-4 w-4 text-blue-500" />;
    }
  };

  const handleClearFilters = () => {
    setStatusFilter("all");
    setCategoryFilter("all");
    setSearchQuery("");
    setDebouncedSearch("");
    setCurrentPage(1);
  };

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/inventory")}
        className={backButtonClassName}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Inventory
      </Button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
          <div className="relative w-full sm:w-[300px]">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by code..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>

          {(statusFilter !== "all" || categoryFilter !== "all" || searchQuery !== "") && (
            <Button variant="outline" size="sm" onClick={handleClearFilters} className="shrink-0 text-muted-foreground hover:text-foreground">
              <X className="mr-2 h-4 w-4" /> Clear Filters
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={isExporting} className="shrink-0">
            {isExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Export
          </Button>
          <Button onClick={() => { setLogToEdit(null); setIsModalOpen(true); }} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" /> Add Log
          </Button>
        </div>
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
                {hasNextPage && (
                  <tr ref={loadMoreRef}>
                    <td colSpan={7} className="py-6 text-center">
                      <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
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
