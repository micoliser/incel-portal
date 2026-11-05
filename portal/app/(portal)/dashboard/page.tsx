"use client";
import { extractApiErrorMessage } from "@/lib/api-errors";

import Image from "next/image";
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
  Eye,
  Users,
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
import { getUserRoleLabel } from "@/lib/auth";
import {
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
  has_global_access?: boolean;
  is_manager?: boolean;
  manager_scope?: {
    role_type: "global" | "department" | "unit" | "team";
    title: string;
    scope_name: string;
    description: string;
  } | null;
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

type TaskViewMode = "assigned_to" | "assigned_by";

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

export function isUnitSupervisorUpwards(
  profile: MeProfile | null,
  permissions: MePermissions | null,
): boolean {
  if (!profile && !permissions) return false;

  // 1. Superuser or global access (ED, MD)
  if (
    permissions?.is_superuser ||
    permissions?.has_global_access ||
    profile?.has_global_access
  ) {
    return true;
  }

  // 2. Executive role codes
  const roleCode = (
    profile?.role_code ||
    permissions?.role_code ||
    ""
  ).toUpperCase();
  if (
    [
      "ED",
      "MD",
      "DIRECTOR",
      "EXECUTIVE_DIRECTOR",
      "MANAGING_DIRECTOR",
      "ADMIN",
    ].includes(roleCode)
  ) {
    return true;
  }

  // 3. Manager scope check (unit supervisor, department line manager, global)
  const roleType = profile?.manager_scope?.role_type;
  if (
    roleType === "global" ||
    roleType === "department" ||
    roleType === "unit"
  ) {
    return true;
  }

  // 4. Role title or manager_scope title check
  const scopeTitle = (profile?.manager_scope?.title || "").toLowerCase();
  if (
    scopeTitle.includes("supervisor") ||
    scopeTitle.includes("manager") ||
    scopeTitle.includes("oversight") ||
    scopeTitle.includes("director")
  ) {
    return true;
  }

  const roleTitle = (profile?.role || "").toLowerCase();
  if (
    roleTitle.includes("managing director") ||
    roleTitle.includes("executive director") ||
    roleTitle.includes("line manager") ||
    roleTitle.includes("department manager") ||
    roleTitle.includes("unit supervisor") ||
    roleTitle.includes("supervisor")
  ) {
    return true;
  }

  return false;
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
  const [taskView, setTaskView] = useState<TaskViewMode>("assigned_to");

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

        const profileData = profileResponse.data as MeProfile;
        const permissionsData = permissionsResponse.data as MePermissions;
        setProfile(profileData);
        setPermissions(permissionsData);
        setApplications(applicationsResponse.data as DashboardApplication[]);

        // Auto-select view based on role: Unit Supervisors upwards default to tasks they assigned
        const shouldDefaultToAssignedBy = isUnitSupervisorUpwards(
          profileData,
          permissionsData,
        );
        setTaskView(shouldDefaultToAssignedBy ? "assigned_by" : "assigned_to");

        // Try to fetch recent apps for the current user (may return up to 4)
        try {
          const recentResp = await apiClient.get<RecentApplicationResponse[]>(
            "/me/recent-applications",
          );
          const recentData = recentResp.data.map((r) => r.application);
          setRecentApps(recentData);
        } catch {
          // silently ignore recent apps failure; dashboard will fall back to defaults
          setRecentApps(null);
        }

        setTaskSummary(dashboardSummaryResponse);
      } catch (error) {
        const message = extractApiErrorMessage(error, "Failed to load dashboard.");
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

  const roleLabel = getUserRoleLabel(profile);
  const departmentLabel =
    profile?.department ||
    (profile?.department_id
      ? `Department ID: ${profile.department_id}`
      : "No department assigned");

  const isSuperuser = Boolean(permissions?.is_superuser);
  const isAdmin = isAdminRole(permissions?.role_code, isSuperuser);

  // Bucket details
  const assignedToMeTasks = taskSummary?.assigned_to.tasks ?? [];
  const assignedByMeTasks = taskSummary?.assigned_by.tasks ?? [];

  const assignedToMeTasksCount = taskSummary?.assigned_to.count ?? 0;
  const assignedToMePending = taskSummary?.assigned_to.pending ?? 0;
  const assignedToMeInProgress = taskSummary?.assigned_to.in_progress ?? 0;
  const assignedToMeCompleted = taskSummary?.assigned_to.completed ?? 0;
  const assignedToMeHighPriority = taskSummary?.assigned_to.high_priority ?? 0;
  const assignedToMeOverdueOrDueSoon =
    taskSummary?.assigned_to.due_soon_or_overdue ?? 0;

  const assignedByMeTasksCount = taskSummary?.assigned_by.count ?? 0;
  const assignedByMePending = taskSummary?.assigned_by.pending ?? 0;
  const assignedByMeInProgress = taskSummary?.assigned_by.in_progress ?? 0;
  const assignedByMeUnderReview = taskSummary?.assigned_by.under_review ?? 0;
  const assignedByMeCompleted = taskSummary?.assigned_by.completed ?? 0;
  const assignedByMeHighPriority = taskSummary?.assigned_by.high_priority ?? 0;
  const assignedByMeOverdueOrDueSoon =
    taskSummary?.assigned_by.due_soon_or_overdue ?? 0;

  const totalTasks = taskSummary?.total.count ?? 0;
  const totalPendingTasks = taskSummary?.total.pending ?? 0;
  const totalInProgressTasks = taskSummary?.total.in_progress ?? 0;
  const totalCompletedTasks = taskSummary?.total.completed ?? 0;
  const totalOverdueTasks = taskSummary?.total.overdue ?? 0;

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

  // Dynamic summary cards based on the selected task view
  const summaryCards =
    taskView === "assigned_by"
      ? [
          {
            title: "Tasks Delegated",
            value: assignedByMeTasksCount,
            description: "Total tasks you assigned to team members.",
            icon: Users,
          },
          {
            title: "In Progress",
            value: assignedByMeInProgress,
            description: "Tasks assignees are actively working on.",
            icon: Clock,
          },
          {
            title: "Under Review",
            value: assignedByMeUnderReview,
            description: "Tasks submitted and awaiting your review.",
            icon: Eye,
          },
          {
            title: "Completed",
            value: assignedByMeCompleted,
            description: "Tasks completed by your assignees.",
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
            value: assignedToMePending,
            description: "Tasks not yet started.",
            icon: AlertCircle,
          },
          {
            title: "In Progress",
            value: assignedToMeInProgress,
            description: "Tasks you're actively working on.",
            icon: Clock,
          },
          {
            title: "High Priority",
            value: assignedToMeHighPriority,
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
          label: "View all tasks",
          description: "Check your tasks and team assignments.",
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

  // Selected view active tasks and counts
  const activeTaskList =
    taskView === "assigned_by" ? assignedByMeTasks : assignedToMeTasks;
  const activeTaskCount =
    taskView === "assigned_by"
      ? assignedByMeTasksCount
      : assignedToMeTasksCount;

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Workspace Command Banner & Quick Actions */}
      <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        <Card className="relative overflow-hidden border-[#0d47a1]/20 bg-gradient-to-br from-[#0d47a1] via-[#0d47a1] to-[#0d47a1] text-white shadow-[0_8px_24px_rgba(13, 71, 161,0.22)]">
          <div className="pointer-events-none absolute -right-12 -top-12 size-56 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-16 right-16 size-44 rounded-full bg-[#0d47a1]/50 blur-xl" />
          <CardHeader className="relative z-10 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur-xs">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Active Workspace
              </span>
              <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white/95 backdrop-blur-xs">
                Role: {roleLabel} · {departmentLabel}
              </span>
            </div>
            <CardTitle className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {fullName}
            </CardTitle>
            <CardDescription className="text-sm text-white/85">
              You are signed in and ready to manage your tasks, reports, and internal applications.
            </CardDescription>
          </CardHeader>
          <CardContent className="relative z-10 pt-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button
                size="sm"
                variant="secondary"
                className="bg-white text-[#0d47a1] font-semibold hover:bg-white/90 border-0 shadow-xs"
                onClick={() => router.push("/tasks")}
              >
                <ListTodo className="mr-1.5 size-4" aria-hidden="true" />
                Open Tasks
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => router.push("/reports")}
              >
                Daily Reports
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                onClick={() => router.push("/applications")}
              >
                Applications
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="justify-between">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Crown className="size-4 text-[#0d47a1]" aria-hidden="true" />
              Quick actions
            </CardTitle>
            <CardDescription>
              Direct shortcuts to your core workflows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => router.push(action.href)}
                className="group flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-muted/35 px-4 py-3 text-left transition-all duration-150 hover:border-[#0d47a1]/40 hover:bg-[#0d47a1]/5"
              >
                <div>
                  <span className="block text-sm font-semibold text-foreground group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8]">
                    {action.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {action.description}
                  </span>
                </div>
                <ArrowRight
                  className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#0d47a1]"
                  aria-hidden="true"
                />
              </button>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Task Overview Header with View Switcher Tabs */}
      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">
            Task Overview
          </h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {taskView === "assigned_by"
              ? "Monitoring tasks you assigned to team members."
              : "Tracking tasks assigned to you."}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-xs">
          <Button
            type="button"
            size="sm"
            variant={taskView === "assigned_to" ? "default" : "ghost"}
            className="h-8 rounded-lg text-xs sm:text-sm"
            onClick={() => setTaskView("assigned_to")}
          >
            <ListTodo className="mr-1.5 h-3.5 w-3.5" />
            Assigned to Me
            {assignedToMeTasksCount > 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  taskView === "assigned_to"
                    ? "bg-white/20 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {assignedToMeTasksCount}
              </span>
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={taskView === "assigned_by" ? "default" : "ghost"}
            className="h-8 rounded-lg text-xs sm:text-sm"
            onClick={() => setTaskView("assigned_by")}
          >
            <Users className="mr-1.5 h-3.5 w-3.5" />
            Tasks I Assigned
            {assignedByMeTasksCount > 0 && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  taskView === "assigned_by"
                    ? "bg-white/20 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {assignedByMeTasksCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* 4 Summary KPI Metric Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          const isHighPriorityCard = card.title.toLowerCase().includes("priority");
          const isCompletedCard = card.title.toLowerCase().includes("completed");
          const iconContainerClass = isHighPriorityCard
            ? "bg-[#dc2626]/10 text-[#dc2626] ring-1 ring-[#dc2626]/20"
            : isCompletedCard
              ? "bg-[#16a34a]/10 text-[#16a34a] ring-1 ring-[#16a34a]/20"
              : "bg-[#0d47a1]/10 text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:text-[#38bdf8]";

          return (
            <Card key={card.title} className="gap-3 py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {card.title}
                  </CardTitle>
                  <div className={`flex size-9 items-center justify-center rounded-lg ${iconContainerClass}`}>
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                <div className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
                  {card.value}
                </div>
                <p className="text-xs text-muted-foreground">
                  {card.description}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Main Task List and Workload / Oversight Section */}
      <section className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/70 pb-4">
            <div className="space-y-1">
              <CardTitle>
                {taskView === "assigned_by"
                  ? "Tasks assigned by you"
                  : "Tasks assigned to you"}
              </CardTitle>
              <CardDescription>
                {taskView === "assigned_by"
                  ? `You have assigned ${assignedByMeTasksCount} tasks to others.`
                  : `You have ${assignedToMeTasksCount} tasks assigned to you.`}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                router.push(
                  taskView === "assigned_by"
                    ? "/tasks?view=created"
                    : "/tasks?view=assigned",
                )
              }
            >
              View all
              <ArrowRight className="ml-1.5 size-3.5" aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent>
            {activeTaskCount === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground">
                <p>
                  {taskView === "assigned_by"
                    ? "No tasks assigned by you right now."
                    : "No tasks assigned to you right now. Great work!"}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border rounded-xl border border-border bg-background/50">
                {activeTaskList.slice(0, 5).map((task) => {
                  const deadline = task.deadline
                    ? new Date(task.deadline)
                    : null;
                  const isOverdue = deadline && isPast(deadline);
                  const isDueSoon =
                    deadline && isDueWithinDays(deadline, 3) && !isOverdue;

                  return (
                    <div
                      key={task.id}
                      onClick={() => router.push(`/tasks/${task.id}`)}
                      className="group flex cursor-pointer flex-col gap-2.5 p-4 transition-colors duration-150 first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-foreground group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8] transition-colors">
                            {task.title}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span>
                              <span className="font-medium text-foreground/80">By:</span>{" "}
                              {task.assigned_by.full_name ||
                                task.assigned_by.username}
                            </span>
                            <span>•</span>
                            <span>
                              <span className="font-medium text-foreground/80">To:</span>{" "}
                              {task.assigned_to.full_name ||
                                task.assigned_to.username}
                            </span>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                            task.status === "completed"
                              ? "border-[#16a34a]/25 bg-[#16a34a]/10 text-[#16a34a] dark:text-[#4ade80]"
                              : task.status === "under_review"
                                ? "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300"
                                : task.status === "in_progress"
                                  ? "border-[#0d47a1]/25 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]"
                                  : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {task.status === "in_progress"
                            ? "In Progress"
                            : task.status === "under_review"
                              ? "Under Review"
                              : task.status === "completed"
                                ? "Completed"
                                : "Pending"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            task.priority === "high"
                              ? "bg-[#dc2626]/10 text-[#dc2626] dark:text-[#f87171]"
                              : task.priority === "medium"
                                ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-2">
                          {deadline && task.status !== "completed" && (
                            <span
                              className={`text-xs font-medium ${
                                isOverdue
                                  ? "text-[#dc2626] dark:text-[#f87171]"
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
                            size="icon-xs"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/tasks/${task.id}`);
                            }}
                            aria-label="View task"
                            title="View task"
                          >
                            <Eye className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workload / Delegation Status Card */}
        <Card>
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle className="text-base">
              {taskView === "assigned_by"
                ? "Delegation & oversight"
                : isAdmin
                  ? "Portal summary"
                  : "Your workload"}
            </CardTitle>
            <CardDescription>
              {taskView === "assigned_by"
                ? "Status of tasks you delegated to others."
                : isAdmin
                  ? "System status and recommendations."
                  : "Quick overview of your responsibilities."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {taskView === "assigned_by" ? (
              <>
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Delegation breakdown
                  </p>
                  <ul className="mt-2.5 space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center justify-between">
                      <span>Pending start</span>
                      <span className="font-semibold tabular-nums text-foreground">{assignedByMePending}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>In progress</span>
                      <span className="font-semibold tabular-nums text-[#0d47a1] dark:text-[#38bdf8]">{assignedByMeInProgress}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Awaiting your review</span>
                      <span className="font-semibold tabular-nums text-foreground">{assignedByMeUnderReview}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>High priority</span>
                      <span className="font-semibold tabular-nums text-[#dc2626]">{assignedByMeHighPriority}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Completed</span>
                      <span className="font-semibold tabular-nums text-[#16a34a]">{assignedByMeCompleted}</span>
                    </li>
                  </ul>
                </div>
                {assignedByMeUnderReview > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#0d47a1]/30 bg-[#0d47a1]/8 p-3.5">
                    <Eye className="mt-0.5 size-4 shrink-0 text-[#0d47a1]" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {pluralize(assignedByMeUnderReview, "task")} waiting for review
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Team members have submitted work for your approval.
                      </p>
                    </div>
                  </div>
                )}
                {assignedByMeOverdueOrDueSoon > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/8 p-3.5">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#dc2626]" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-[#dc2626] dark:text-[#f87171]">
                        {pluralize(assignedByMeOverdueOrDueSoon, "task")} due soon or overdue
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Follow up with assignees to keep timelines on track.
                      </p>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Management tips
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                    <li>• Review submitted tasks promptly to unblock assignees.</li>
                    <li>• Check in on tasks with approaching deadlines.</li>
                    <li>• Provide constructive feedback in task comments.</li>
                  </ul>
                </div>
              </>
            ) : isAdmin ? (
              <>
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    System snapshot
                  </p>
                  <ul className="mt-2.5 space-y-2 text-sm text-muted-foreground">
                    <li>
                      • {pluralize(totalTasks, "task")} in the system (
                      {totalPendingTasks} pending, {totalInProgressTasks} in
                      progress, {totalCompletedTasks} completed)
                    </li>
                    {totalOverdueTasks > 0 && (
                      <li className="text-[#dc2626]">
                        • {pluralize(totalOverdueTasks, "overdue task")} across
                        teams
                      </li>
                    )}
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
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Action items
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
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
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Priority summary
                  </p>
                  <ul className="mt-2.5 space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-center justify-between">
                      <span>Pending tasks</span>
                      <span className="font-semibold tabular-nums text-foreground">{assignedToMePending}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>In progress</span>
                      <span className="font-semibold tabular-nums text-[#0d47a1] dark:text-[#38bdf8]">{assignedToMeInProgress}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>High priority</span>
                      <span className="font-semibold tabular-nums text-[#dc2626]">{assignedToMeHighPriority}</span>
                    </li>
                    <li className="flex items-center justify-between">
                      <span>Completed</span>
                      <span className="font-semibold tabular-nums text-[#16a34a]">{assignedToMeCompleted}</span>
                    </li>
                  </ul>
                </div>
                {assignedToMeOverdueOrDueSoon > 0 && (
                  <div className="flex items-start gap-3 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/8 p-3.5">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-[#dc2626]" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-semibold text-[#dc2626] dark:text-[#f87171]">
                        {pluralize(assignedToMeOverdueOrDueSoon, "task")} due soon or overdue
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Review and update these before the deadline.
                      </p>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border border-border bg-muted/35 p-4">
                  <p className="text-sm font-semibold text-foreground">
                    Next steps
                  </p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
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

      {/* Applications Section */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b border-border/70 pb-4">
            <CardTitle>Recent applications</CardTitle>
            <CardDescription>
              View your most recently accessed applications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {recentApps && recentApps.length > 0 ? (
                recentApps.map((application) => (
                  <div
                    key={application.id}
                    className="group flex flex-col justify-between rounded-xl border border-border bg-background/60 p-4 transition-all duration-150 hover:border-[#0d47a1]/40 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <Image
                            src={application.logo_url ?? "/vercel.svg"}
                            alt={`${application.name} logo`}
                            className="h-10 w-10 rounded-lg object-cover bg-muted ring-1 ring-border"
                            width={40}
                            height={40}
                            unoptimized
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
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                            application.can_access === false
                              ? "border-[#dc2626]/25 bg-[#dc2626]/10 text-[#dc2626]"
                              : application.status === "MAINTENANCE"
                                ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "border-[#16a34a]/25 bg-[#16a34a]/10 text-[#16a34a] dark:text-[#4ade80]"
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
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="w-full"
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
                          } catch {
                            toast.error("Failed to open application.");
                            router.push("/applications");
                          }
                        }}
                      >
                        Open Application
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-4">
                  <p>
                    You have not opened any applications yet.{" "}
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => router.push("/applications")}
                      className="px-1"
                    >
                      Go to Applications
                    </Button>{" "}
                    to start.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
