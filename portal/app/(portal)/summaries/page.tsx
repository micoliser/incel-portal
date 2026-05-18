"use client";

import axios from "axios";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { formatDistanceToNow, format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Calendar,
  Share2,
  Copy,
  Check,
  TrendingUp,
  CheckCircle,
  FileText,
  MessageSquare,
  Clock,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import {
  summariesAPI,
  WeeklySummary,
  AvailableWeek,
} from "@/lib/api/summaries";

function SummariesContent() {
  const searchParams = useSearchParams();
  const shareToken = searchParams.get("token");
  const isSharedView = !!shareToken;

  const [availableWeeks, setAvailableWeeks] = useState<AvailableWeek[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string | null>(null);
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch available weeks on mount (only for non-shared view)
  useEffect(() => {
    if (isSharedView) {
      // For shared view, fetch the shared summary directly
      if (!shareToken) {
        setError("Invalid or missing share token");
        setLoading(false);
        return;
      }

      const fetchSharedSummary = async () => {
        try {
          setLoading(true);
          const data = await summariesAPI.getSharedSummary(shareToken);
          setSummary(data);
          setError(null);
        } catch (err: any) {
          if (err.response?.status === 403) {
            setError("This share link has expired");
          } else if (err.response?.status === 404) {
            setError("Invalid share link");
          } else {
            setError("Failed to load the shared summary");
          }
          console.error(err);
          setSummary(null);
        } finally {
          setLoading(false);
        }
      };

      fetchSharedSummary();
    } else {
      // For normal view, fetch available weeks
      const fetchWeeks = async () => {
        try {
          const weeks = await summariesAPI.getAvailableWeeks();
          setAvailableWeeks(weeks);

          if (weeks.length > 0) {
            // Auto-select the most recent week
            setSelectedWeek(weeks[0].week_start_date);
          }
        } catch (err) {
          setError("Failed to load available weeks");
          console.error(err);
        } finally {
          setLoading(false);
        }
      };

      fetchWeeks();
    }
  }, [isSharedView, shareToken]);

  // Fetch summary when selected week changes
  useEffect(() => {
    if (!selectedWeek) return;

    const fetchSummary = async () => {
      try {
        setLoading(true);
        const summaryData = await summariesAPI.getSummary(selectedWeek);
        setSummary(summaryData);
        setError(null);
      } catch (err) {
        setError("Failed to load summary for the selected week");
        console.error(err);
        setSummary(null);
      } finally {
        setLoading(false);
      }
    };

    fetchSummary();
  }, [selectedWeek]);

  const handleCreateShare = async () => {
    if (!selectedWeek) return;

    try {
      setCreatingShare(true);
      const response = await summariesAPI.createShareLink(selectedWeek);
      // Build frontend-friendly share link that points to the consolidated summaries page
      const frontendPath = `/summaries?token=${response.share_token}`;
      setShares((prev) => ({
        ...prev,
        [selectedWeek]: frontendPath,
      }));
      toast.success("Share link created! Copy it to share.");
    } catch (err) {
      toast.error("Failed to create share link");
      console.error(err);
    } finally {
      setCreatingShare(false);
    }
  };

  const handleCopyLink = (link: string) => {
    const fullLink = `${window.location.origin}${link}`;
    navigator.clipboard.writeText(fullLink);
    setCopiedToken(link);
    toast.success("Link copied to clipboard!");
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const getPriorityBadgeClasses = (priority: string) => {
    if (priority === "high") {
      return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200";
    }

    if (priority === "medium") {
      return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-200";
    }

    return "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200";
  };

  const getStatusBadgeClasses = (status: string) => {
    if (status === "completed") {
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200";
    }

    if (status === "in_progress") {
      return "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200";
    }

    return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200";
  };

  if (loading && !isSharedView && availableWeeks.length === 0) {
    return <DashboardSkeleton />;
  }

  if (loading && isSharedView) {
    return <DashboardSkeleton />;
  }

  if (error && !summary) {
    if (isSharedView) {
      return (
        <Card className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900">
          <CardHeader>
            <CardTitle className="text-red-900 dark:text-red-300 flex items-center space-x-2">
              <AlertCircle className="w-5 h-5" />
              <span>Cannot Load Summary</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-700 dark:text-red-400">{error}</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <PageErrorCard
        title="Failed to Load Summary"
        message={error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!isSharedView && availableWeeks.length === 0) {
    return (
      <div className="container mx-auto py-10">
        <Card className="bg-blue-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900">
          <CardHeader>
            <CardTitle className="text-blue-900 dark:text-blue-300">
              No Summaries Yet
            </CardTitle>
            <CardDescription className="text-blue-700 dark:text-blue-400">
              Weekly summaries are generated every Monday. Check back next week!
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-14rem)] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-9rem)] bg-transparent">
      {/* Sidebar - Week Navigation (only for non-shared view) */}
      {!isSharedView && (
        <aside
          className={`sticky top-0 flex h-[calc(100dvh-14rem)] shrink-0 flex-col border-r border-t border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-300 dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(9,15,26,0.98)_0%,rgba(4,8,15,0.98)_100%)] sm:h-[calc(100dvh-10rem)] lg:h-[calc(100dvh-9rem)] ${
            sidebarCollapsed ? "w-16" : "w-72"
          }`}
        >
          {/* Toggle Button */}
          <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-3 dark:border-slate-700/70">
            {!sidebarCollapsed && (
              <span className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60">
                Weeks
              </span>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="ml-auto rounded-lg p-1 hover:bg-muted dark:hover:bg-slate-700/50"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="w-5 h-5" />
              ) : (
                <ChevronLeft className="w-5 h-5" />
              )}
            </button>
          </div>

          {/* Week List - Scrollable */}
          <div className="flex-1 overflow-y-auto px-2 py-3 pt-3">
            {availableWeeks.length > 0 ? (
              <div className="space-y-1">
                {availableWeeks.map((week) => (
                  <button
                    key={week.week_start_date}
                    onClick={() => setSelectedWeek(week.week_start_date)}
                    className={`w-full rounded-lg transition-colors ${
                      selectedWeek === week.week_start_date
                        ? "bg-accent text-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-muted hover:text-foreground"
                    } ${sidebarCollapsed ? "flex items-center justify-center p-2" : "text-left px-3 py-3"}`}
                    title={
                      sidebarCollapsed
                        ? `Week ${format(parseISO(week.week_start_date), "dd/MM/yy")} - ${format(parseISO(week.week_end_date), "dd/MM/yy")}`
                        : undefined
                    }
                  >
                    {sidebarCollapsed ? (
                      <Calendar className="w-5 h-5 shrink-0" />
                    ) : (
                      <div className="flex items-center space-x-2">
                        <Calendar className="w-4 h-4 shrink-0" />
                        <div className="text-sm">
                          Week{" "}
                          {format(parseISO(week.week_start_date), "dd/MM/yy")} -{" "}
                          {format(parseISO(week.week_end_date), "dd/MM/yy")}
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div
                className={`text-sm text-gray-600 dark:text-slate-400 ${sidebarCollapsed ? "hidden" : "p-4"}`}
              >
                No weeks available yet
              </div>
            )}
          </div>
        </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-8 p-8">
          {/* Shared View Header (only shown for shared) */}
          {isSharedView && summary && (
            <div className="space-y-2 mb-8">
              <h1 className="text-4xl font-bold dark:text-white">
                {summary.user_name}'s Weekly Summary
              </h1>
              <p className="text-gray-600 dark:text-slate-400 flex items-center space-x-2">
                <Calendar className="w-4 h-4" />
                <span>
                  {format(parseISO(summary.week_start_date), "MMMM d")} -{" "}
                  {format(parseISO(summary.week_end_date), "MMMM d, yyyy")}
                </span>
              </p>
            </div>
          )}

          {/* Summary Content - Loading, Error, No Week Selected, or Loaded */}
          {loading && !summary ? (
            <DashboardSkeleton />
          ) : error && !summary ? (
            <Card className="bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-900">
              <CardHeader>
                <CardTitle className="text-red-900 dark:text-red-300 flex items-center space-x-2">
                  <AlertCircle className="w-5 h-5" />
                  <span>Error Loading Summary</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-red-700 dark:text-red-400">{error}</p>
              </CardContent>
            </Card>
          ) : !selectedWeek && !isSharedView ? (
            <Card className="bg-blue-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900">
              <CardHeader>
                <CardTitle className="text-blue-900 dark:text-blue-300">
                  Select a Week
                </CardTitle>
                <CardDescription className="text-blue-700 dark:text-blue-400">
                  Choose a week from the sidebar to view its summary.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : summary ? (
            <>
              {/* Summary Message - conditional display */}
              <h1 className="text-xl text-gray-800 dark:text-slate-200">
                {summary.summary_message}
              </h1>

              {/* Main Stats Grid - Same for both views */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      Tasks Created
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.tasks_created}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      This week
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      Tasks Completed
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.tasks_completed}/{summary.tasks_assigned}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      {summary.completion_rate_percent}% completion rate
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium text-gray-600 dark:text-slate-400">
                      On-Time Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {summary.on_time_completion_rate_percent}%
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                      {summary.on_time_completion_rate_percent >= 80
                        ? "Great work!"
                        : "Room for improvement"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Engagement Metrics - Same for both views */}
              <Card>
                <CardHeader>
                  <CardTitle>Engagement</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <MessageSquare className="w-5 h-5 text-blue-500 dark:text-blue-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Comments Added
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.comments_added}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-5 h-5 text-green-500 dark:text-green-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Files Attached
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.files_attached}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Clock className="w-5 h-5 text-purple-500 dark:text-purple-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Active Recurring Schedules
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.active_recurring_schedules}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <TrendingUp className="w-5 h-5 text-orange-500 dark:text-orange-400" />
                        <span className="text-gray-700 dark:text-slate-300">
                          Schedules Created
                        </span>
                      </div>
                      <span className="text-2xl font-bold">
                        {summary.recurring_schedules_created}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Priority Distribution - Same for both views */}
              <Card>
                <CardHeader>
                  <CardTitle>Task Breakdown</CardTitle>
                  <CardDescription>
                    {isSharedView
                      ? "Tasks by priority and status"
                      : "Your tasks by priority and status"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-sm mb-3">
                        By Priority
                      </h3>
                      <div className="space-y-2">
                        {Object.entries(summary.priority_distribution).map(
                          ([priority, count]) => (
                            <div
                              key={priority}
                              className="flex items-center justify-between gap-3"
                            >
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getPriorityBadgeClasses(priority)}`}
                              >
                                {priority}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-slate-100">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-semibold text-sm mb-3">By Status</h3>
                      <div className="space-y-2">
                        {Object.entries(summary.status_distribution).map(
                          ([status, count]) => (
                            <div
                              key={status}
                              className="flex items-center justify-between gap-3"
                            >
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getStatusBadgeClasses(status)}`}
                              >
                                {status === "in_progress"
                                  ? "In Progress"
                                  : status === "completed"
                                    ? "Completed"
                                    : "Pending"}
                              </span>
                              <span className="font-semibold text-gray-900 dark:text-slate-100">
                                {count}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Share Section - only for non-shared view */}
              {!isSharedView && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center space-x-2">
                      <Share2 className="w-5 h-5" />
                      <span>Share This Summary</span>
                    </CardTitle>
                    <CardDescription>
                      Create a public link to share your summary with others
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {shares[selectedWeek || ""] ? (
                      <div className="flex space-x-2">
                        <input
                          type="text"
                          value={`${window.location.origin}${shares[selectedWeek || ""]}`}
                          readOnly
                          className="flex-1 px-3 py-2 border rounded-md bg-gray-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 text-sm"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            handleCopyLink(shares[selectedWeek || ""])
                          }
                        >
                          {copiedToken === shares[selectedWeek || ""] ? (
                            <>
                              <Check className="w-4 h-4 mr-1" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4 mr-1" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                    ) : (
                      <Button
                        onClick={handleCreateShare}
                        disabled={creatingShare}
                        className="w-full"
                      >
                        <Share2 className="w-4 h-4 mr-2" />
                        {creatingShare ? "Creating..." : "Create Share Link"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SummariesPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <SummariesContent />
    </Suspense>
  );
}
