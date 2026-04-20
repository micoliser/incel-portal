"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  AppWindow,
  BadgeCheck,
  Crown,
  Lock,
  Loader2,
  Shield,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";

type MeProfile = {
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  role?: string | null;
  role_code?: string | null;
  department?: string | null;
  department_id?: number | null;
};

type MePermissions = {
  is_superuser?: boolean;
  has_global_access?: boolean;
  role_code?: string | null;
  department_id?: number | null;
};

type DashboardApplication = {
  id: number;
  name: string;
  slug: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  access_scope: "ALL_AUTHENTICATED" | "RESTRICTED";
  visibility_scope: "VISIBLE_TO_ALL" | "HIDDEN";
  department_ids?: number[];
  can_access?: boolean;
  reason?: string;
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

export default function DashboardPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [permissions, setPermissions] = useState<MePermissions | null>(null);
  const [applications, setApplications] = useState<DashboardApplication[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoadError(null);
        const [profileResponse, permissionsResponse, applicationsResponse] =
          await Promise.all([
            apiClient.get("/me"),
            apiClient.get("/me/permissions"),
            apiClient.get("/applications"),
          ]);

        setProfile(profileResponse.data as MeProfile);
        setPermissions(permissionsResponse.data as MePermissions);
        setApplications(applicationsResponse.data as DashboardApplication[]);
      } catch (error) {
        const message = axios.isAxiosError(error)
          ? ((error.response?.data?.detail as string | undefined) ??
            "Failed to load dashboard.")
          : "Failed to load dashboard.";
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

  const accessibleApps = useMemo(
    () =>
      applications.filter((application) => application.can_access !== false),
    [applications],
  );
  const blockedApps = useMemo(
    () =>
      applications.filter((application) => application.can_access === false),
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
  const hiddenApps = useMemo(
    () =>
      applications.filter(
        (application) => application.visibility_scope === "HIDDEN",
      ),
    [applications],
  );
  const departmentApps = useMemo(() => {
    if (!profile?.department_id) {
      return [];
    }

    return applications.filter((application) =>
      (application.department_ids ?? []).includes(profile.department_id ?? 0),
    );
  }, [applications, profile?.department_id]);

  const topAccessibleApps = accessibleApps.slice(0, 6);
  const topBlockedApps = blockedApps.slice(0, 4);
  const topDepartmentApps = departmentApps.slice(0, 6);
  const topAdminApps = applications.slice(0, 6);

  const summaryCards = isAdmin
    ? [
        {
          title: "Applications",
          value: applications.length,
          description: "Total applications in the portal.",
          icon: AppWindow,
        },
        {
          title: "Active",
          value: activeApps.length,
          description: "Applications ready to open.",
          icon: BadgeCheck,
        },
        {
          title: "Maintenance",
          value: maintenanceApps.length,
          description: "Applications temporarily unavailable.",
          icon: TriangleAlert,
        },
        {
          title: "Hidden",
          value: hiddenApps.length,
          description: "Applications not visible to all users.",
          icon: Lock,
        },
      ]
    : hasGlobalAccess
      ? [
          {
            title: "Accessible",
            value: accessibleApps.length,
            description: "Applications you can open right now.",
            icon: BadgeCheck,
          },
          {
            title: "Department",
            value: departmentApps.length,
            description: "Applications tied to your department.",
            icon: Shield,
          },
          {
            title: "Blocked",
            value: blockedApps.length,
            description: "Applications currently denied to you.",
            icon: Lock,
          },
          {
            title: "Maintenance",
            value: maintenanceApps.length,
            description: "Applications temporarily unavailable.",
            icon: TriangleAlert,
          },
        ]
      : [
          {
            title: "Accessible",
            value: accessibleApps.length,
            description: "Applications ready for you.",
            icon: BadgeCheck,
          },
          {
            title: "Restricted",
            value: blockedApps.length,
            description: "Applications you cannot open yet.",
            icon: Lock,
          },
          {
            title: "Active",
            value: activeApps.length,
            description: "Applications currently online.",
            icon: AppWindow,
          },
          {
            title: "Maintenance",
            value: maintenanceApps.length,
            description: "Applications temporarily unavailable.",
            icon: TriangleAlert,
          },
        ];

  const quickActions = isAdmin
    ? [
        {
          href: "/applications",
          label: "Manage applications",
          description: "Create, edit, and manage access.",
        },
        {
          href: "/applications",
          label: "Review access",
          description: "Open the applications directory.",
        },
      ]
    : [
        {
          href: "/applications",
          label: "Open applications",
          description: "Browse everything available in the portal.",
        },
        {
          href: "/applications",
          label: "Search by name",
          description: "Jump straight to the application list.",
        },
      ];

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-border bg-card px-5 py-3 text-sm font-medium text-muted-foreground shadow-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <Card className="w-full max-w-2xl border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <TriangleAlert className="size-5" aria-hidden="true" />
              Dashboard unavailable
            </CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.refresh()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
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
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/50 p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Session
              </p>
              <p className="mt-2 text-sm text-foreground">
                You are signed in and ready to use the portal.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-muted/50 p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Access mode
              </p>
              <p className="mt-2 text-sm text-foreground">
                {isAdmin
                  ? "Administrator controls are available."
                  : hasGlobalAccess
                    ? "You have broad access across departments."
                    : "Your access is scoped to your assigned permissions."}
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

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              {isAdmin
                ? "Recent applications snapshot"
                : hasGlobalAccess
                  ? "Apps you can open now"
                  : "Your accessible applications"}
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? `A quick view of ${applications.length} applications in the portal.`
                : hasGlobalAccess
                  ? `You can open ${accessibleApps.length} applications right now.`
                  : `You can open ${accessibleApps.length} applications right now.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {(isAdmin
                ? topAdminApps
                : hasGlobalAccess
                  ? topAccessibleApps
                  : topAccessibleApps
              ).map((application) => (
                <div
                  key={application.id}
                  className="rounded-xl border border-border bg-background p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {application.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {application.slug}
                      </p>
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
                    {application.can_access === false
                      ? application.reason || "Access is currently blocked."
                      : application.access_scope === "RESTRICTED"
                        ? "This app is limited to specific departments or overrides."
                        : "This app is available to authenticated users."}
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => router.push("/applications")}
                    >
                      Open
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {isAdmin
                ? "Admin focus"
                : hasGlobalAccess
                  ? "Department view"
                  : "Blocked applications"}
            </CardTitle>
            <CardDescription>
              {isAdmin
                ? "Management-oriented highlights for administrators."
                : hasGlobalAccess
                  ? "Apps connected to your department or broad access profile."
                  : "Applications you cannot access yet, with reasons when available."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isAdmin ? (
              <>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    Management summary
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {pluralize(applications.length, "application")},{" "}
                    {pluralize(activeApps.length, "active app")}, and{" "}
                    {pluralize(maintenanceApps.length, "maintenance app")} are
                    visible right now.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-sm font-semibold text-foreground">
                    Suggested next steps
                  </p>
                  <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                    <li>• Review hidden applications and access overrides.</li>
                    <li>
                      • Create or update applications from the Applications
                      page.
                    </li>
                    <li>
                      • Keep descriptions and logos current for the most used
                      apps.
                    </li>
                  </ul>
                </div>
              </>
            ) : hasGlobalAccess ? (
              <div className="space-y-3">
                {topDepartmentApps.length > 0 ? (
                  topDepartmentApps.map((application) => (
                    <div
                      key={application.id}
                      className="rounded-xl border border-border bg-muted/30 p-4 dark:border-slate-700 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">
                            {application.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {application.access_scope === "RESTRICTED"
                              ? "Department-limited"
                              : "Available to authenticated users"}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => router.push("/applications")}
                        >
                          Open
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60">
                    No department-specific applications are assigned to you yet.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {topBlockedApps.length > 0 ? (
                  topBlockedApps.map((application) => (
                    <div
                      key={application.id}
                      className="rounded-xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900 dark:bg-red-950/25"
                    >
                      <p className="font-semibold text-red-800 dark:text-red-100">
                        {application.name}
                      </p>
                      <p className="mt-1 text-sm text-red-700 dark:text-red-200">
                        {application.reason ||
                          "Access is restricted for your account."}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground dark:border-slate-700 dark:bg-slate-900/60">
                    No blocked applications to show right now.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
