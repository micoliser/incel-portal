"use client";

import axios from "axios";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useCallback } from "react";
import {
  Calendar,
  CheckSquare2,
  ListTodo,
  Eye,
  EyeOff,
  Building2,
  KeyRound,
  AppWindow,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Target,
  ScrollText,
  Sun,
  LifeBuoy,
  TrendingUp,
  Users,
  Network,
  X,
  Package,
  Archive,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotificationCenter } from "@/components/notification-center";
import { cn } from "@/lib/utils";
import {
  clearStoredTokens,
  buildLoginPath,
  getUserRoleLabel,
} from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import Image from "next/image";

export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isAdmin, setIsAdmin] = useState(false);
  const [userInfo, setUserInfo] = useState<{
    username?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    role?: string | null;
    role_code?: string | null;
    department?: string | null;
    department_id?: number | string | null;
    department_code?: string | null;
    has_global_access?: boolean;
    is_manager?: boolean;
    manager_scope?: {
      role_type: "global" | "department" | "unit" | "team";
      title: string;
      scope_name: string;
      description: string;
    } | null;
  } | null>(null);
  const [changePasswordForm, setChangePasswordForm] = useState({
    old_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [showChangeNewPassword, setShowChangeNewPassword] = useState(false);
  const [changePasswordErrors, setChangePasswordErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [changePasswordApiError, setChangePasswordApiError] = useState("");

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("portal_theme");
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const nextTheme: "light" | "dark" =
      storedTheme === "dark" || storedTheme === "light"
        ? storedTheme
        : prefersDark
          ? "dark"
          : "light";
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");

    const search =
      typeof window !== "undefined" ? (window.location.search ?? "") : "";
    const currentPath = `${pathname}${search}`;

    async function loadUserContext() {
      try {
        const [response, permissionsResponse] = await Promise.all([
          apiClient.get("/me"),
          apiClient.get("/me/permissions"),
        ]);

        const data = response.data as {
          username?: string;
          first_name?: string;
          last_name?: string;
          email?: string;
          role?: string | null;
          role_code?: string | null;
          department?: string | null;
          department_id?: number | string | null;
          department_code?: string | null;
          has_global_access?: boolean;
          is_manager?: boolean;
          manager_scope?: {
            role_type: "global" | "department" | "unit" | "team";
            title: string;
            scope_name: string;
            description: string;
          } | null;
        };
        const permissionsData = permissionsResponse.data as {
          is_superuser?: boolean;
          role_code?: string | null;
        };

        setUserInfo(data);
        const isAdminUser = Boolean(permissionsData.is_superuser) ||
            String(permissionsData.role_code ?? "").toUpperCase() === "ADMIN";
        setIsAdmin(isAdminUser);

        // Route guarding
        const hasGlobalAccess = Boolean(data.has_global_access);
        const isIT = String(data.department_code ?? "").toUpperCase() === "IT";
        
        if (pathname.startsWith("/users") && !isAdminUser && !hasGlobalAccess) {
          router.replace("/dashboard");
        } else if ((pathname.startsWith("/departments") || pathname.startsWith("/organization-summary")) && !isAdminUser && !hasGlobalAccess) {
          router.replace("/dashboard");
        } else if (pathname.startsWith("/inventory") && !isAdminUser && !hasGlobalAccess && !isIT) {
          router.replace("/dashboard");
        } else if (pathname.startsWith("/logs") && !isAdminUser && !hasGlobalAccess) {
          router.replace("/dashboard");
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          clearStoredTokens();
          router.replace(buildLoginPath(currentPath));
          return;
        }
        setUserInfo(null);
        setIsAdmin(false);
      } finally {
        setIsCheckingAuth(false);
      }
    }

    void loadUserContext();
  }, [pathname, router]);

  const pageHeader = pathname.startsWith("/summaries")
    ? {
        title: "Weekly Summary",
        subtitle: "Review your work activity and progress for the past weeks.",
      }
    : pathname.startsWith("/reports")
      ? {
          title: "Reports",
          subtitle:
            "Track daily reports, subreports, and departmental updates.",
        }
      : pathname.startsWith("/goals")
        ? {
            title: "Goals",
            subtitle: "Create current-week goals and track live progress.",
          }
        : pathname === "/applications"
          ? {
              title: "Applications",
              subtitle: "Browse and manage internal application access.",
            }
            : pathname === "/users" || pathname.startsWith("/users")
              ? {
                  title: "Users",
                  subtitle: "Manage workspace users.",
                }
              : pathname === "/departments" || pathname.startsWith("/departments")
                ? {
                    title: "Departments",
                    subtitle: "Manage organizational structure and hierarchies.",
                  }
            : pathname === "/logs"
              ? {
                  title: "Logs",
                  subtitle: "Review audit events and activity history.",
                }
              : pathname.startsWith("/my-assets")
                ? {
                    title: "My Assets",
                    subtitle: "View the hardware and equipment assigned to you.",
                  }
                : pathname.startsWith("/inventory")
                  ? {
                      title: "Inventory Management",
                      subtitle: "Manage company assets, categories, and assignments.",
                    }
                  : pathname.startsWith("/support")
                ? {
                    title: "Support",
                    subtitle: "Submit and track support requests",
                  }
                : pathname.startsWith("/todos")
                  ? {
                      title: "My To-Dos",
                      subtitle: "Personal task checklist and timed reminders.",
                    }
                : pathname.startsWith("/tasks")
                  ? {
                      title: "Tasks",
                      subtitle: "Manage and track your tasks.",
                    }
                  : {
                      title: "Dashboard",
                      subtitle: "Your portal workspace is ready.",
                    };

  const fullName =
    [userInfo?.first_name, userInfo?.last_name].filter(Boolean).join(" ") ||
    userInfo?.username ||
    userInfo?.email?.split("@")[0] ||
    "Portal User";

  const roleLabel = getUserRoleLabel(userInfo);
  const departmentLabel =
    userInfo?.department ||
    (userInfo?.department_id
      ? `Department ID: ${userInfo.department_id}`
      : "No department");
  const initials =
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "PU";

  const handleLogout = useCallback(
    async (reason?: "inactivity" | "manual") => {
      try {
        await apiClient.post("/auth/logout", {});
      } catch {
        // ignore errors on logout
      } finally {
        clearStoredTokens();
        if (reason === "inactivity") {
          const search =
            typeof window !== "undefined" ? (window.location.search ?? "") : "";
          const currentPath = `${pathname}${search}`;
          const loginPath = buildLoginPath(currentPath);
          const inactivityLoginPath = loginPath.includes("?")
            ? `${loginPath}&reason=inactivity`
            : "/?reason=inactivity";
          router.replace(inactivityLoginPath);
        } else {
          // For manual logout/default behavior, go to landing/login immediately.
          router.replace("/");
        }
      }
    },
    [pathname, router],
  );

  // Inactivity auto-logout: track last activity across tabs and call logout
  // after 1 hour (3600 seconds) of inactivity. Also send a lightweight
  // heartbeat to the server when activity is detected to keep server-side
  // last_activity_at in sync.
  useEffect(() => {
    const LAST_ACTIVITY_KEY = "portal_last_activity";
    const INACTIVITY_SECONDS = 60 * 60; // 1 hour
    const HEARTBEAT_THROTTLE = 60 * 1000; // 60 seconds

    let inactivityTimer: number | null = null;
    const lastHeartbeatRef = { ts: 0 } as { ts: number };

    const bc =
      typeof window !== "undefined" && "BroadcastChannel" in window
        ? new BroadcastChannel("portal-auth")
        : null;

    const now = () => Math.floor(Date.now() / 1000);

    function readLastActivity(): number {
      try {
        const v = window.localStorage.getItem(LAST_ACTIVITY_KEY);
        if (!v) return 0;
        return parseInt(v, 10) || 0;
      } catch {
        return 0;
      }
    }

    function writeLastActivity(ts: number) {
      try {
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
      } catch {}
    }

    async function sendHeartbeatIfNeeded() {
      try {
        if (Date.now() - lastHeartbeatRef.ts < HEARTBEAT_THROTTLE) return;
        lastHeartbeatRef.ts = Date.now();
        await apiClient.post("/auth/heartbeat");
      } catch {
        // ignore heartbeat errors
      }
    }

    function scheduleInactivityCheck() {
      if (inactivityTimer) {
        window.clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      const last = readLastActivity();
      const elapsed = now() - last;
      const remaining = INACTIVITY_SECONDS - elapsed;
      if (remaining <= 0) {
        void handleLogout("inactivity");
        if (bc) bc.postMessage({ type: "logout", reason: "inactivity" });
        try {
          window.localStorage.setItem(
            "portal_auth_event",
            JSON.stringify({ type: "logout", reason: "inactivity" }),
          );
        } catch {}
        return;
      }
      inactivityTimer = window.setTimeout(() => {
        void handleLogout("inactivity");
        if (bc) bc.postMessage({ type: "logout", reason: "inactivity" });
        try {
          window.localStorage.setItem(
            "portal_auth_event",
            JSON.stringify({ type: "logout", reason: "inactivity" }),
          );
        } catch {}
      }, remaining * 1000);
    }

    function onActivity() {
      const ts = now();
      writeLastActivity(ts);
      void sendHeartbeatIfNeeded();
      scheduleInactivityCheck();
      if (bc) bc.postMessage({ type: "activity", ts });
    }

    // Initialize
    const initial = readLastActivity();
    if (!initial) writeLastActivity(now());
    scheduleInactivityCheck();

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    for (const ev of events)
      window.addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onActivity);

    if (bc) {
      bc.addEventListener("message", (ev) => {
        const data = ev.data || {};
        if (data.type === "logout") {
          // Another tab logged out — ensure this tab also logs out
          void handleLogout(
            data.reason === "inactivity" ? "inactivity" : undefined,
          );
        } else if (data.type === "activity" && data.ts) {
          writeLastActivity(Number(data.ts));
          scheduleInactivityCheck();
        }
      });
    } else {
      // Fallback: listen to storage events (we update LAST_ACTIVITY_KEY)
      window.addEventListener("storage", (ev) => {
        if (!ev.key) return;
        if (ev.key === LAST_ACTIVITY_KEY && ev.newValue) {
          const ts = parseInt(ev.newValue, 10) || 0;
          if (ts) {
            writeLastActivity(ts);
            scheduleInactivityCheck();
          }
        }
        if (ev.key === "portal_auth_event" && ev.newValue) {
          try {
            const obj = JSON.parse(ev.newValue);
            if (obj?.type === "logout")
              void handleLogout(
                obj.reason === "inactivity" ? "inactivity" : undefined,
              );
          } catch {}
        }
      });
    }

    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onActivity);
      if (inactivityTimer) window.clearTimeout(inactivityTimer);
      if (bc) bc.close();
    };
  }, [handleLogout]);

  function handleCloseSidebar() {
    setIsSidebarOpen(false);
  }

  function resetChangePasswordForm() {
    setChangePasswordForm({
      old_password: "",
      new_password: "",
      confirm_password: "",
    });
    setChangePasswordErrors({});
    setChangePasswordApiError("");
    setShowChangeNewPassword(false);
  }

  function validateChangePasswordForm() {
    const errors: Record<string, string> = {};

    if (!changePasswordForm.old_password) {
      errors.old_password = "Old password is required.";
    }

    if (!changePasswordForm.new_password) {
      errors.new_password = "New password is required.";
    } else if (changePasswordForm.new_password.length < 8) {
      errors.new_password = "Password must be at least 8 characters.";
    }

    if (
      changePasswordForm.new_password !== changePasswordForm.confirm_password
    ) {
      errors.confirm_password = "Passwords do not match.";
    }

    return errors;
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();

    const errors = validateChangePasswordForm();
    setChangePasswordErrors(errors);
    setChangePasswordApiError("");

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      setIsChangingPassword(true);
      await apiClient.post("/auth/change-password", {
        old_password: changePasswordForm.old_password,
        new_password: changePasswordForm.new_password,
      });
      resetChangePasswordForm();
      setIsChangePasswordOpen(false);
      setIsSidebarOpen(false);
      toast.success("Password changed.");
    } catch (error) {
      setChangePasswordApiError(
        extractApiErrorMessage(error, "Failed to change password."),
      );
      toast.error(extractApiErrorMessage(error, "Failed to change password."));
    } finally {
      setIsChangingPassword(false);
    }
  }

  function handleToggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const toggle = () => {
      root.classList.toggle("dark", nextTheme === "dark");
      setTheme(nextTheme);
      window.localStorage.setItem("portal_theme", nextTheme);
    };

    root.classList.add("theme-switching");
    const documentWithTransition = document as Document & {
      startViewTransition?: (callback: () => void) => {
        finished: Promise<void>;
      };
    };

    if (documentWithTransition.startViewTransition) {
      const transition = documentWithTransition.startViewTransition(toggle);
      void transition.finished.finally(() => {
        root.classList.remove("theme-switching");
      });
      return;
    }

    toggle();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        root.classList.remove("theme-switching");
      });
    });
  }

  if (isCheckingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-xs">
          Loading workspace...
        </div>
      </main>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar-border bg-sidebar px-4 py-5 text-sidebar-foreground shadow-[0_4px_20px_rgba(9,9,11,0.04)] transition-transform duration-200 ease-out dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]",
          "-translate-x-full lg:translate-x-0",
          isSidebarOpen && "translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-sidebar-border px-2 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 p-1.5 ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20">
              <Image src="/logo2.png" alt="Incel Group" width={36} height={36} className="object-contain" />
            </div>
            <div>
              <p className="text-base font-bold tracking-tight text-sidebar-foreground">
                Incel Group
              </p>
              <p className="text-xs font-medium text-muted-foreground">
                Enterprise Portal
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseSidebar}
            aria-label="Close sidebar"
            className="lg:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>

        <nav className="mt-4 flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-1 pb-4">
          {/* Group 1: Overview & Work */}
          <div className="flex flex-col gap-1">
            <Link
              href="/dashboard"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname === "/dashboard"
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <LayoutDashboard
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname === "/dashboard"
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Dashboard</span>
            </Link>

            <Link
              href="/tasks"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/tasks")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <CheckSquare2
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/tasks")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Tasks</span>
            </Link>

            <Link
              href="/todos"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/todos")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ListTodo
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/todos")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>My To-Dos</span>
            </Link>

            <Link
              href="/goals"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/goals")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Target
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/goals")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Goals</span>
            </Link>
          </div>

          {/* Group 2: Insights & Workspace */}
          <div className="flex flex-col gap-1 border-t border-sidebar-border/70 pt-3">
            <Link
              href="/reports"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/reports")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Calendar
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/reports")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Reports</span>
            </Link>

            <Link
              href="/summaries"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/summaries")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <TrendingUp
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/summaries")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Summaries</span>
            </Link>

            <Link
              href="/applications"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname === "/applications"
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <AppWindow
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname === "/applications"
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Applications</span>
            </Link>

            <Link
              href="/my-assets"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/my-assets")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Package
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/my-assets")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>My Assets</span>
            </Link>

            <Link
              href="/support"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                pathname.startsWith("/support")
                  ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <LifeBuoy
                className={cn(
                  "size-4 transition-transform duration-150",
                  pathname.startsWith("/support")
                    ? "text-white"
                    : "text-muted-foreground group-hover:text-foreground",
                )}
                aria-hidden="true"
              />
              <span>Support</span>
            </Link>
          </div>

          {/* Group 3: Administration & Oversight */}
          {isAdmin || userInfo?.has_global_access || userInfo?.department === "IT" ? (
            <div className="flex flex-col gap-1 border-t border-sidebar-border/70 pt-3">
              {isAdmin || userInfo?.has_global_access ? (
                <Link
                  href="/users"
                  onClick={handleCloseSidebar}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    pathname === "/users"
                      ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Users
                    className={cn(
                      "size-4 transition-transform duration-150",
                      pathname === "/users"
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span>Users</span>
                </Link>
              ) : null}

              {isAdmin || userInfo?.has_global_access ? (
                <Link
                  href="/departments"
                  onClick={handleCloseSidebar}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    pathname === "/departments"
                      ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Network
                    className={cn(
                      "size-4 transition-transform duration-150",
                      pathname === "/departments"
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span>Departments</span>
                </Link>
              ) : null}

              {isAdmin || userInfo?.has_global_access || userInfo?.department === "IT" ? (
                <Link
                  href="/inventory"
                  onClick={handleCloseSidebar}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    pathname.startsWith("/inventory")
                      ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Archive
                    className={cn(
                      "size-4 transition-transform duration-150",
                      pathname.startsWith("/inventory")
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span>Inventory</span>
                </Link>
              ) : null}

              {isAdmin || userInfo?.has_global_access ? (
                <Link
                  href="/organization-summary"
                  onClick={handleCloseSidebar}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    pathname === "/organization-summary"
                      ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Building2
                    className={cn(
                      "size-4 transition-transform duration-150",
                      pathname === "/organization-summary"
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span>Organization</span>
                </Link>
              ) : null}

              {isAdmin || userInfo?.has_global_access ? (
                <Link
                  href="/logs"
                  onClick={handleCloseSidebar}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                    pathname === "/logs"
                      ? "bg-[#0d47a1] text-white shadow-[0_2px_8px_rgba(13, 71, 161,0.28)] font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <ScrollText
                    className={cn(
                      "size-4 transition-transform duration-150",
                      pathname === "/logs"
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span>Logs</span>
                </Link>
              ) : null}
            </div>
          ) : null}
        </nav>

        <div className="mt-auto border-t border-sidebar-border pt-3 flex-shrink-0">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:bg-[#dc2626]/10 hover:text-[#dc2626]"
            onClick={() => setLogoutConfirmOpen(true)}
          >
            <LogOut className="mr-2 size-4" aria-hidden="true" />
            Log out
          </Button>
        </div>
      </aside>

      {isSidebarOpen ? (
        <button
          type="button"
          onClick={handleCloseSidebar}
          className="fixed inset-0 z-30 bg-black/45 backdrop-blur-[1px] lg:hidden"
          aria-label="Close sidebar overlay"
        />
      ) : null}

      <header className="fixed left-0 right-0 top-0 z-20 lg:left-72">
        <div className="flex min-h-[72px] sm:h-[72px] items-center justify-between gap-4 border-b border-border bg-card/90 px-4 py-3 shadow-[0_1px_3px_rgba(9,9,11,0.03)] backdrop-blur-md sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              className="lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {pageHeader.title}
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                {pathname === "/dashboard"
                  ? `Welcome${userInfo?.first_name ? `, ${userInfo.first_name}` : ""}`
                  : pageHeader.subtitle}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2.5 sm:gap-3">
            <NotificationCenter />

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsChangePasswordOpen(true)}
              className="w-9 sm:w-auto px-0 sm:px-3"
            >
              <KeyRound className="size-4 sm:mr-1.5" aria-hidden="true" />
              <span className="hidden sm:inline">Change password</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={handleToggleTheme}
              aria-label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              title={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
            >
              {theme === "dark" ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </Button>

            <div className="hidden h-7 w-px bg-border sm:block" />

            <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-muted/40 px-2.5 py-1.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-[#0d47a1] text-xs font-bold text-white shadow-xs">
                {initials}
              </div>
              <div className="leading-tight hidden sm:block">
                <p className="text-sm font-semibold text-foreground">
                  {fullName}
                </p>
                <p className="text-xs font-medium text-[#0d47a1] dark:text-[#38bdf8]">{roleLabel}</p>
                <p className="text-[11px] text-muted-foreground">{departmentLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "h-screen max-w-full lg:ml-72",
          pathname === "/summaries"
            ? "pt-[72px] overflow-hidden"
            : "overflow-y-auto overflow-x-hidden pt-[105px] px-4 pb-8 sm:px-6 sm:pb-10 lg:px-8",
        )}
      >
        {children}
      </main>

      <Dialog
        open={isChangePasswordOpen}
        onOpenChange={(open) => {
          setIsChangePasswordOpen(open);
          if (!open) {
            resetChangePasswordForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<KeyRound className="size-4.5" />}>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Update your login password for the portal.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={handleChangePassword}
            className="space-y-4 py-2"
            noValidate
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="change_old_password">Old password</Label>
              <Input
                id="change_old_password"
                type="password"
                value={changePasswordForm.old_password}
                onChange={(event) => {
                  setChangePasswordForm((current) => ({
                    ...current,
                    old_password: event.target.value,
                  }));
                  setChangePasswordErrors((current) => ({
                    ...current,
                    old_password: undefined,
                  }));
                  setChangePasswordApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(changePasswordErrors.old_password)}
              />
              {changePasswordErrors.old_password ? (
                <p className="mt-1 text-xs text-destructive">
                  {changePasswordErrors.old_password}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="change_new_password">New password</Label>
              <div className="relative mt-2">
                <Input
                  id="change_new_password"
                  type={showChangeNewPassword ? "text" : "password"}
                  value={changePasswordForm.new_password}
                  onChange={(event) => {
                    setChangePasswordForm((current) => ({
                      ...current,
                      new_password: event.target.value,
                    }));
                    setChangePasswordErrors((current) => ({
                      ...current,
                      new_password: undefined,
                    }));
                    setChangePasswordApiError("");
                  }}
                  className="pr-10"
                  aria-invalid={Boolean(changePasswordErrors.new_password)}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-muted/50"
                  onClick={() =>
                    setShowChangeNewPassword((current) => !current)
                  }
                  aria-label={
                    showChangeNewPassword ? "Hide password" : "Show password"
                  }
                >
                  {showChangeNewPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {changePasswordErrors.new_password ? (
                <p className="mt-1 text-xs text-destructive">
                  {changePasswordErrors.new_password}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="change_confirm_password">Confirm password</Label>
              <Input
                id="change_confirm_password"
                type="password"
                value={changePasswordForm.confirm_password}
                onChange={(event) => {
                  setChangePasswordForm((current) => ({
                    ...current,
                    confirm_password: event.target.value,
                  }));
                  setChangePasswordErrors((current) => ({
                    ...current,
                    confirm_password: undefined,
                  }));
                  setChangePasswordApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(changePasswordErrors.confirm_password)}
              />
              {changePasswordErrors.confirm_password ? (
                <p className="mt-1 text-xs text-destructive">
                  {changePasswordErrors.confirm_password}
                </p>
              ) : null}
            </div>

            {changePasswordApiError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {changePasswordApiError}
              </div>
            ) : null}

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsChangePasswordOpen(false)}
                disabled={isChangingPassword}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isChangingPassword}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
              >
                {isChangingPassword ? "Saving..." : "Change password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<LogOut className="size-4.5" />}
            iconClassName="bg-[#dc2626]/10 text-[#dc2626] ring-[#dc2626]/20 dark:bg-[#dc2626]/20 dark:text-red-400"
          >
            <DialogTitle>Log out of Incel Portal?</DialogTitle>
            <DialogDescription>
              Are you sure you want to end your current session? You will be redirected to the sign-in screen.
            </DialogDescription>
          </DialogHeader>

          {userInfo ? (
            <div className="my-1 flex items-center gap-3 rounded-xl border border-border/70 bg-muted/40 p-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1] text-xs font-semibold text-white shadow-xs">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {fullName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {userInfo.email || userInfo.username}
                </p>
              </div>
              {roleLabel ? (
                <span className="shrink-0 rounded-full border border-border/80 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {roleLabel}
                </span>
              ) : null}
            </div>
          ) : null}

          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setLogoutConfirmOpen(false)}
              disabled={isLoggingOut}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isLoggingOut}
              onClick={async () => {
                setIsLoggingOut(true);
                try {
                  await handleLogout("manual");
                } finally {
                  setIsLoggingOut(false);
                  setLogoutConfirmOpen(false);
                }
              }}
              className="gap-2"
            >
              {isLoggingOut ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Logging out...</span>
                </>
              ) : (
                <>
                  <LogOut className="size-3.5" />
                  <span>Log out</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
