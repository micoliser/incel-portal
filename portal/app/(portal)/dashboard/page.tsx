"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Crown,
  Sparkles,
  CheckCircle,
  Clock,
  AlertCircle,
  ListTodo,
  Zap,
  Calendar,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  addDays,
  formatDistanceToNow,
  isPast,
  isWithinInterval,
} from "date-fns";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";
import { PageErrorCard } from "@/components/page-error-card";
import { apiClient } from "@/lib/api-client";
import {
  Task,
  TaskDashboardSummaryResponse,
  getTaskDashboardSummary,
} from "@/lib/api/tasks";

type MeProfile = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string | null;
  role_code?: string | null;
  department?: string | null;
  department_id?: string | null;
};

type MePermissions = {
  is_superuser?: boolean;
  has_global_access?: boolean;
  role_code?: string | null;
  department_id?: string | null;
};

type DashboardApplication = {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  access_scope: "ALL_AUTHENTICATED" | "RESTRICTED";
  visibility_scope: "VISIBLE_TO_ALL" | "HIDDEN";
  department_ids?: string[];
  description?: string | null;
  logo_url?: string | null;
  can_access?: boolean;
  reason?: string;
};

type RecentApplicationResponse = {
  id: string;
  application: DashboardApplication;
  opened_at: string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isAdminRole(
  roleCode: string | null | undefined,
  isSuperuser: boolean,
) {
  return Boolean(
    isSuperuser || String(roleCode ?? "").toUpperCase() === "ADMIN",
  );
}

function isDueWithinDays(date: Date, days: number) {
  return isWithinInterval(date, {
    start: new Date(),
    end: addDays(new Date(), days),
  });
}

export default function DashboardPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [permissions, setPermissions] = useState<MePermissions | null>(null);
  const [applications, setApplications] = useState<DashboardApplication[]>([]);
  const [recentApps, setRecentApps] = useState<DashboardApplication[] | null>(
    null,
  );
  const [taskSummary, setTaskSummary] =
    useState<TaskDashboardSummaryResponse | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoadError(null);
        const [
          profileResponse,
          permissionsResponse,
          applicationsResponse,
          dashboardSummaryResponse,
        ] = await Promise.all([
          apiClient.get("/me"),
          apiClient.get("/me/permissions"),
          apiClient.get("/applications"),
          getTaskDashboardSummary(),
        ]);

        setProfile(profileResponse.data as MeProfile);
        setPermissions(permissionsResponse.data as MePermissions);
        setApplications(applicationsResponse.data as DashboardApplication[]);
        // Try to fetch recent apps for the current user (may return up to 4)
        try {
          const recentResp = await apiClient.get<RecentApplicationResponse[]>(
            "/me/recent-applications",
          );
          const recentData = recentResp.data.map((r) => r.application);
          setRecentApps(recentData);
        } catch (err) {
          // silently ignore recent apps failure; dashboard will fall back to defaults
          setRecentApps(null);
        }

        setTaskSummary(dashboardSummaryResponse);
      } catch (error) {
        const message = axios.isAxiosError(error)
          ? ((error.response?.data?.detail as string | undefined) ??
            "Failed to load dashboard.")
          : "Failed to load dashboard.";
        toast.error(message);
        setLoadError(message);
      } finally {
        setIsLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  const fullName =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
    profile?.username ||
    profile?.email?.split("@")[0] ||
    "Portal User";

  const roleLabel = profile?.role_code || profile?.role || "Unknown role";
  const departmentLabel =
    profile?.department ||
    (profile?.department_id
      ? `Department ID: ${profile.department_id}`
      : "No department assigned");

  const isSuperuser = Boolean(permissions?.is_superuser);
  const hasGlobalAccess = Boolean(permissions?.has_global_access);
  const isAdmin = isAdminRole(permissions?.role_code, isSuperuser);

  const assignedToMeTasks = taskSummary?.assigned_to.tasks ?? [];
  const assignedByMeTasks = taskSummary?.assigned_by.tasks ?? [];

  const assignedToMeTasksCount = taskSummary?.assigned_to.count ?? 0;
  const pendingTasks = taskSummary?.assigned_to.pending ?? 0;
  const inProgressTasks = taskSummary?.assigned_to.in_progress ?? 0;
  const completedTasks = taskSummary?.assigned_to.completed ?? 0;
  const highPriorityTasks = taskSummary?.assigned_to.high_priority ?? 0;
  const overdueOrDueSoonTasks =
    taskSummary?.assigned_to.due_soon_or_overdue ?? 0;

  const assignedByMeTasksCount = taskSummary?.assigned_by.count ?? 0;
  const pendingAssignedByMe = taskSummary?.assigned_by.pending ?? 0;
  const inProgressAssignedByMe = taskSummary?.assigned_by.in_progress ?? 0;
  const completedAssignedByMe = taskSummary?.assigned_by.completed ?? 0;
  const highPriorityAssignedByMe = taskSummary?.assigned_by.high_priority ?? 0;
  const overdueOrDueSoonAssignedByMe =
    taskSummary?.assigned_by.due_soon_or_overdue ?? 0;

  const totalTasks = taskSummary?.total.count ?? 0;
  const totalPendingTasks = taskSummary?.total.pending ?? 0;
  const totalInProgressTasks = taskSummary?.total.in_progress ?? 0;
  const totalCompletedTasks = taskSummary?.total.completed ?? 0;
  const totalOverdueTasks = taskSummary?.total.overdue ?? 0;

  const accessibleApps = useMemo(
    () =>
      applications.filter((application) => application.can_access !== false),
    [applications],
  );
  const activeApps = useMemo(
    () => applications.filter((application) => application.status === "ACTIVE"),
    [applications],
  );
  const maintenanceApps = useMemo(
    () =>
      applications.filter(
        (application) => application.status === "MAINTENANCE",
      ),
    [applications],
  );

  const topAccessibleApps = accessibleApps.slice(0, 5);
  const topAdminApps = applications.slice(0, 4);

  const summaryCards = isAdmin
    ? [
        {
          title: "Assigned Tasks",
          value: assignedToMeTasksCount,
          description: "Total tasks assigned to you.",
          icon: ListTodo,
        },
        {
          title: "Pending",
          value: pendingTasks,
          description: "Tasks not yet started.",
          icon: AlertCircle,
        },
        {
          title: "In Progress",
          value: inProgressTasks,
          description: "Tasks you're actively working on.",
          icon: Clock,
        },
        {
          title: "High Priority",
          value: highPriorityTasks,
          description: "Urgent tasks needing attention.",
          icon: Zap,
        },
      ]
    : hasGlobalAccess
      ? [
          {
            title: "Assigned Tasks",
            value: assignedToMeTasksCount,
            description: "Total tasks assigned to you.",
            icon: ListTodo,
          },
          {
            title: "In Progress",
            value: inProgressTasks,
            description: "Tasks you're currently working on.",
            icon: Clock,
          },
          {
            title: "Due Soon",
            value: overdueOrDueSoonTasks,
            description: "Tasks due within 3 days or overdue.",
            icon: Calendar,
          },
          {
            title: "Completed",
            value: completedTasks,
            description: "Tasks you've finished.",
            icon: CheckCircle,
          },
        ]
      : [
          {
            title: "Assigned Tasks",
            value: assignedToMeTasksCount,
            description: "Total tasks assigned to you.",
            icon: ListTodo,
          },
          {
            title: "Pending",
            value: pendingTasks,
            description: "Tasks not yet started.",
            icon: AlertCircle,
          },
          {
            title: "In Progress",
            value: inProgressTasks,
            description: "Tasks you're actively working on.",
            icon: Clock,
          },
          {
            title: "High Priority",
            value: highPriorityTasks,
            description: "Urgent tasks needing attention.",
            icon: Zap,
          },
        ];

  const quickActions = isAdmin
    ? [
        {
          href: "/tasks",
          label: "Manage tasks",
          description: "View and manage all tasks.",
        },
        {
          href: "/applications",
          label: "Manage applications",
          description: "Create, edit, and manage access.",
        },
      ]
    : [
        {
          href: "/tasks",
          label: "View my tasks",
          description: "Check tasks assigned to you.",
        },
        {
          href: "/applications",
          label: "View applications",
          description: "Browse available applications.",
        },
      ];

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (loadError) {
    return (
      <PageErrorCard
        title="Dashboard unavailable"
        message={loadError}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="size-5" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-[0.24em]">
                Welcome back
              </span>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-3xl tracking-tight sm:text-4xl">
                {fullName}
              </CardTitle>
              <CardDescription className="text-base">
                Role: {roleLabel} · {departmentLabel}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-1">
            <div className="rounded-xl border border-border bg-muted/50 p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Session
              </p>
              <p className="mt-2 text-sm text-foreground">
                You are signed in and ready to use the portal.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Crown className="size-5 text-primary" aria-hidden="true" />
              Quick actions
            </CardTitle>
            <CardDescription>
              Shortcuts to the most useful portal tasks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {quickActions.map((action) => (
              <Button
                key={action.label}
                variant="outline"
                className="h-auto w-full justify-between rounded-xl px-4 py-4 text-left"
                onClick={() => router.push(action.href)}
              >
                <>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      {action.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {action.description}
                    </span>
                  </span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              </Button>
            ))}
            {isAdmin ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60">
                Admins can also create new applications and manage access from
                the Applications page.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.title}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base font-semibold">
                    {card.title}
                  </CardTitle>
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                </div>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold tracking-tight text-foreground">
                  {card.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Your assigned tasks</CardTitle>
            <CardDescription>
              {`You have ${assignedToMeTasksCount} tasks assigned to you.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assignedToMeTasksCount === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60">
                <p>No tasks assigned to you right now. Great work!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignedToMeTasks.slice(0, 5).map((task) => {
                  const deadline = task.deadline
                    ? new Date(task.deadline)
                    : null;
                  const isOverdue = deadline && isPast(deadline);
                  const isDueSoon =
                    deadline && isDueWithinDays(deadline, 3) && !isOverdue;

                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-border bg-background p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-semibold text-foreground">
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Created by{" "}
                            {task.assigned_by.full_name ||
                              task.assigned_by.username}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                            task.status === "completed"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                              : task.status === "in_progress"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                          }`}
                        >
                          {task.status === "in_progress"
                            ? "In Progress"
                            : task.status === "completed"
                              ? "Completed"
                              : "Pending"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                            task.priority === "high"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200"
                              : task.priority === "medium"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-200"
                                : "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200"
                          }`}
                        >
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-2">
                          {deadline && task.status !== "completed" && (
                            <span
                              className={`text-xs font-medium ${
                                isOverdue
                                  ? "text-red-600 dark:text-red-400"
                                  : isDueSoon
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {isOverdue ? "Overdue" : "Due"}{" "}
                              {formatDistanceToNow(deadline, {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/tasks/${task.id}`)}
                            aria-label="View task"
                            title="View task"
                            className="p-1 group hover:bg-primary/10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            <Eye
                              className="h-4 w-4 text-muted-foreground transition-transform duration-150 ease-in-out group-hover:scale-110 group-hover:text-primary"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {assignedToMeTasksCount > 5 && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push("/tasks")}
                  >
                    View all {assignedToMeTasksCount} tasks
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks you assigned</CardTitle>
            <CardDescription>
              You have {assignedByMeTasksCount} tasks assigned to others.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {assignedByMeTasksCount === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60">
                <p>No tasks assigned by you right now.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignedByMeTasks.slice(0, 5).map((task) => {
                  const deadline = task.deadline
                    ? new Date(task.deadline)
                    : null;
                  const isOverdue = deadline && isPast(deadline);
                  const isDueSoon =
                    deadline && isDueWithinDays(deadline, 3) && !isOverdue;

                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-border bg-background p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-semibold text-foreground">
                            {task.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Assigned to{" "}
                            {task.assigned_to.full_name ||
                              task.assigned_to.username}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                            task.status === "completed"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                              : task.status === "in_progress"
                                ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-200"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                          }`}
                        >
                          {task.status === "in_progress"
                            ? "In Progress"
                            : task.status === "completed"
                              ? "Completed"
                              : "Pending"}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wide ${
                            task.priority === "high"
                              ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200"
                              : task.priority === "medium"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-200"
                                : "bg-gray-100 text-gray-700 dark:bg-gray-950/60 dark:text-gray-200"
                          }`}
                        >
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-2">
                          {deadline && task.status !== "completed" && (
                            <span
                              className={`text-xs font-medium ${
                                isOverdue
                                  ? "text-red-600 dark:text-red-400"
                                  : isDueSoon
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {isOverdue ? "Overdue" : "Due"}{" "}
                              {formatDistanceToNow(deadline, {
                                addSuffix: true,
                              })}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => router.push(`/tasks/${task.id}`)}
                            aria-label="View task"
                            title="View task"
                            className="p-1 group hover:bg-primary/10 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          >
                            <Eye
                              className="h-4 w-4 text-muted-foreground transition-transform duration-150 ease-in-out group-hover:scale-110 group-hover:text-primary"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {assignedByMeTasksCount > 5 && (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => router.push("/tasks?filter=assigned-by-me")}
                  >
                    View all {assignedByMeTasksCount} tasks
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your focus</CardTitle>
            <CardDescription>Quick stats on your workload.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isAdmin ? (
              <>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Assigned
                    </span>
                    <span className="text-2xl font-bold text-foreground">
                      {assignedToMeTasksCount}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Pending
                    </span>
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      {pendingTasks}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      In Progress
                    </span>
                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {inProgressTasks}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Completed
                    </span>
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {completedTasks}
                    </span>
                  </p>
                </div>
                {overdueOrDueSoonTasks > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/25">
                    <p className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-200">
                        Due Soon/Overdue
                      </span>
                      <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {overdueOrDueSoonTasks}
                      </span>
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-t-2 border-border bg-muted/20 p-4 mt-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground mb-3">
                    System-wide metrics
                  </p>
                  <div className="space-y-3">
                    <div>
                      <p className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Total Tasks
                        </span>
                        <span className="text-lg font-bold text-foreground">
                          {totalTasks}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Pending
                        </span>
                        <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                          {totalPendingTasks}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          In Progress
                        </span>
                        <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          {totalInProgressTasks}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Completed
                        </span>
                        <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {totalCompletedTasks}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center justify-between">
                        <span className="text-sm font-medium text-red-700 dark:text-red-200">
                          Overdue
                        </span>
                        <span className="text-lg font-bold text-red-600 dark:text-red-400">
                          {totalOverdueTasks}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Total Assigned
                    </span>
                    <span className="text-2xl font-bold text-foreground">
                      {assignedToMeTasksCount}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Pending
                    </span>
                    <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                      {pendingTasks}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      In Progress
                    </span>
                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {inProgressTasks}
                    </span>
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Completed
                    </span>
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {completedTasks}
                    </span>
                  </p>
                </div>
                {overdueOrDueSoonTasks > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/25">
                    <p className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-200">
                        Due Soon/Overdue
                      </span>
                      <span className="text-lg font-bold text-amber-600 dark:text-amber-400">
                        {overdueOrDueSoonTasks}
                      </span>
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent applications</CardTitle>
            <CardDescription>
              View your most recently accessed applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {recentApps && recentApps.length > 0 ? (
                recentApps.map((application) => (
                  <div
                    key={application.id}
                    className="rounded-xl border border-border bg-background p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={application.logo_url ?? "/vercel.svg"}
                          alt={`${application.name} logo`}
                          className="h-10 w-10 rounded-md object-cover bg-muted"
                        />
                        <div>
                          <p className="font-semibold text-foreground">
                            {application.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {application.slug}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                          application.can_access === false
                            ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-200"
                            : application.status === "MAINTENANCE"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-200"
                              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200"
                        }`}
                      >
                        {application.can_access === false
                          ? "Restricted"
                          : application.status.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                      {application.description
                        ? application.description
                        : "No description available."}
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            const resp = await apiClient.post(
                              `/applications/${application.id}/open`,
                            );
                            const url = resp?.data?.url;
                            if (url) {
                              window.open(url, "_blank", "noopener,noreferrer");
                            } else {
                              router.push("/applications");
                            }
                          } catch (error) {
                            toast.error("Failed to open application.");
                            router.push("/applications");
                          }
                        }}
                      >
                        Open
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60 sm:col-span-2">
                  <p>
                    You have not opened any applications yet.
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push("/applications")}
                      className="underline"
                    >
                      Go to Applications
                    </Button>
                    to start.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {isAdmin ? "Portal summary" : "Your workload"}
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? "System status and recommendations."
                : "Quick overview of your responsibilities."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isAdmin ? (
              <>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    System snapshot
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>• {pluralize(totalTasks, "task")} in the system</li>
                    <li>
                      • {pluralize(applications.length, "application")}{" "}
                      available
                    </li>
                    <li>
                      • {pluralize(activeApps.length, "active app")} and{" "}
                      {pluralize(maintenanceApps.length, "in maintenance")}
                    </li>
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    Action items
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>• Monitor overdue and high-priority tasks.</li>
                    <li>
                      • Manage application access and maintenance windows.
                    </li>
                    <li>• Review task completion and team performance.</li>
                  </ul>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    Priority summary
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>
                      • You have {pluralize(pendingTasks, "pending task")}
                    </li>
                    <li>• {pluralize(inProgressTasks, "task")} in progress</li>
                    <li>
                      • {pluralize(highPriorityTasks, "high-priority task")}
                    </li>
                  </ul>
                </div>
                {overdueOrDueSoonTasks > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/25">
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-100">
                      ⚠️ {pluralize(overdueOrDueSoonTasks, "task")} due soon or
                      overdue
                    </p>
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-200">
                      Review and update these before the deadline.
                    </p>
                  </div>
                )}
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    Next steps
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>• Start pending tasks with the highest priority.</li>
                    <li>• Keep deadlines on track and communicate updates.</li>
                    <li>• Check completed tasks for final reviews.</li>
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
