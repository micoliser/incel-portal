"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SupportListSkeleton } from "@/components/skeletons/support-skeleton";
import { CreateSupportRequestModal } from "@/components/create-support-request-modal";
import {
  type SupportRequest,
  getMyRequests,
  getDepartmentRequests,
} from "@/lib/api/support";
import { extractApiErrorMessage } from "@/lib/api-errors";

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  assigned:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  in_progress:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  resolved:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  closed: "bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

export default function SupportListPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "department">("mine");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data =
        tab === "mine" ? await getMyRequests() : await getDepartmentRequests();
      setRequests(data);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load requests."));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filtered = requests.filter((r) =>
    statusFilter === "all" ? true : r.status === statusFilter,
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Support</h1>
          <p className="text-sm text-muted-foreground">
            Submit and track support requests
          </p>
        </div>
        <CreateSupportRequestModal />
      </div>

      <div className="flex items-center gap-4 border-b pb-3">
        <button
          onClick={() => setTab("mine")}
          className={`text-sm font-medium transition-colors ${
            tab === "mine"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          My Requests
        </button>
        <button
          onClick={() => setTab("department")}
          className={`text-sm font-medium transition-colors ${
            tab === "department"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Department
        </button>

        <div className="ml-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading ? (
        <SupportListSkeleton />
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p className="text-lg font-medium">No requests found</p>
            <p className="mt-1 text-sm">
              {tab === "mine"
                ? 'Click "New Request" to submit one.'
                : "No department requests yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((req) => (
            <button
              key={req.id}
              onClick={() => router.push(`/support/${req.id}`)}
              className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{req.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {req.requester.full_name} &middot; {req.department.name}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    className={STATUS_COLORS[req.status] || ""}
                    variant="outline"
                  >
                    {req.status.replace("_", " ")}
                  </Badge>
                  <Badge
                    className={PRIORITY_COLORS[req.priority] || ""}
                    variant="outline"
                  >
                    {req.priority}
                  </Badge>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
