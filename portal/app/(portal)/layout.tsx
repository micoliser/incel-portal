"use client";

import axios from "axios";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useCallback } from "react";
import {
  Calendar,
  CheckSquare2,
  Eye,
  EyeOff,
  Building2,
  KeyRound,
  AppWindow,
  LayoutDashboard,
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
  getStoredAccessToken,
  getStoredRefreshToken,
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
    department_id?: number | null;
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

    const accessToken = getStoredAccessToken();
    const refreshToken = getStoredRefreshToken();
    const search =
      typeof window !== "undefined" ? (window.location.search ?? "") : "";
    const currentPath = `${pathname}${search}`;

    if (!accessToken || !refreshToken) {
      router.replace(buildLoginPath(currentPath));
      return;
    }

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
          department_id?: number | null;
        };
        const permissionsData = permissionsResponse.data as {
          is_superuser?: boolean;
          role_code?: string | null;
        };

        setUserInfo(data);
        setIsAdmin(
          Boolean(permissionsData.is_superuser) ||
            String(permissionsData.role_code ?? "").toUpperCase() === "ADMIN",
        );
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

  const roleLabel = userInfo?.role_code || userInfo?.role || "Unknown role";
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
      const accessToken = getStoredAccessToken();
      const refreshToken = getStoredRefreshToken();

      try {
        if (accessToken && refreshToken) {
          await apiClient.post("/auth/logout", { refresh: refreshToken });
        }
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
      toast.error("Failed to change password.");
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
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-sidebar-border bg-sidebar p-5 text-sidebar-foreground shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur transition-transform duration-300 ease-out dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(9,15,26,0.98)_0%,rgba(4,8,15,0.98)_100%)] dark:shadow-[0_22px_44px_rgba(2,6,23,0.62)]",
          "-translate-x-full lg:translate-x-0",
          isSidebarOpen && "translate-x-0",
        )}
      >
        <div className="flex items-center justify-between gap-3 rounded-2xl px-1 py-3">
          <div className="flex items-center gap-3">
            <Image src="/logo2.png" alt="Incel Group" width={50} height={50} />
            <div>
              <p className="text-base font-semibold leading-tight text-sidebar-foreground">
                Incel Group
              </p>
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                Workspace
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

        <nav className="mt-6 flex flex-1 flex-col gap-2">
          <Link
            href="/dashboard"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname === "/dashboard"
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname === "/dashboard" ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <LayoutDashboard
              className={cn(
                "size-4 transition-transform duration-300",
                pathname === "/dashboard"
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Dashboard</span>
          </Link>

          <Link
            href="/tasks"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/tasks")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/tasks") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <CheckSquare2
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/tasks")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Tasks</span>
          </Link>

          <Link
            href="/reports"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/reports")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/reports") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <Calendar
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/reports")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Reports</span>
          </Link>

          <Link
            href="/applications"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname === "/applications"
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname === "/applications" ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <AppWindow
              className={cn(
                "size-4 transition-transform duration-300",
                pathname === "/applications"
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Applications</span>
          </Link>

          <Link
            href="/goals"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/goals")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/goals") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <Target
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/goals")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Goals</span>
          </Link>

          <Link
            href="/support"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/support")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/support") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <LifeBuoy
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/support")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Support</span>
          </Link>

          <Link
            href="/summaries"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/summaries")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/summaries") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <TrendingUp
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/summaries")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Summaries</span>
          </Link>

          <Link
            href="/my-assets"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname.startsWith("/my-assets")
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname.startsWith("/my-assets") ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <Package
              className={cn(
                "size-4 transition-transform duration-300",
                pathname.startsWith("/my-assets")
                  ? "scale-110"
                  : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>My Assets</span>
          </Link>

          {isAdmin ? (
            <Link
              href="/users"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
                pathname === "/users"
                  ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                  pathname === "/users" ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
              <Users
                className={cn(
                  "size-4 transition-transform duration-300",
                  pathname === "/users" ? "scale-110" : "group-hover:scale-105",
                )}
                aria-hidden="true"
              />
              <span>Users</span>
            </Link>
          ) : null}

          {isAdmin ? (
            <Link
              href="/departments"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
                pathname === "/departments"
                  ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                  pathname === "/departments" ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
              <Network
                className={cn(
                  "size-4 transition-transform duration-300",
                  pathname === "/departments" ? "scale-110" : "group-hover:scale-105",
                )}
                aria-hidden="true"
              />
              <span>Departments</span>
            </Link>
          ) : null}

          {isAdmin ? (
            <Link
              href="/inventory"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
                pathname.startsWith("/inventory")
                  ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                  pathname.startsWith("/inventory") ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
              <Archive
                className={cn(
                  "size-4 transition-transform duration-300",
                  pathname.startsWith("/inventory") ? "scale-110" : "group-hover:scale-105",
                )}
                aria-hidden="true"
              />
              <span>Inventory</span>
            </Link>
          ) : null}



          {isAdmin ? (
            <Link
              href="/organization-summary"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
                pathname === "/organization-summary"
                  ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                  pathname === "/organization-summary"
                    ? "opacity-100"
                    : "opacity-0",
                )}
                aria-hidden="true"
              />
              <Building2
                className={cn(
                  "size-4 transition-transform duration-300",
                  pathname === "/organization-summary"
                    ? "scale-110"
                    : "group-hover:scale-105",
                )}
                aria-hidden="true"
              />
              <span>Organization</span>
            </Link>
          ) : null}

          {isAdmin ? (
            <Link
              href="/logs"
              onClick={handleCloseSidebar}
              className={cn(
                "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
                pathname === "/logs"
                  ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                  pathname === "/logs" ? "opacity-100" : "opacity-0",
                )}
                aria-hidden="true"
              />
              <ScrollText
                className={cn(
                  "size-4 transition-transform duration-300",
                  pathname === "/logs" ? "scale-110" : "group-hover:scale-105",
                )}
                aria-hidden="true"
              />
              <span>Logs</span>
            </Link>
          ) : null}
        </nav>

        <Button
          variant="secondary"
          className="w-full justify-start"
          onClick={() => void handleLogout()}
        >
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          Log out
        </Button>
      </aside>

      {isSidebarOpen ? (
        <button
          type="button"
          onClick={handleCloseSidebar}
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-[1px] lg:hidden"
          aria-label="Close sidebar overlay"
        />
      ) : null}

      <header className="fixed left-0 right-0 top-0 z-20 lg:left-72">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sidebar-border bg-sidebar px-4 py-4 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur sm:px-6 dark:border-slate-700/70 dark:bg-[linear-gradient(180deg,rgba(10,16,28,0.95)_0%,rgba(4,8,15,0.95)_100%)] dark:shadow-[0_18px_34px_rgba(2,6,23,0.56)]">
          <div className="flex items-start gap-3">
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Open sidebar"
              className="lg:hidden"
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/85">
                Workspace
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {pageHeader.title}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {pathname === "/dashboard"
                  ? `Welcome${userInfo?.first_name ? `, ${userInfo.first_name}` : ""}`
                  : pageHeader.subtitle}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <NotificationCenter />

            <Button
              type="button"
              variant="outline"
              onClick={() => setIsChangePasswordOpen(true)}
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              <KeyRound className="mr-2 size-4" aria-hidden="true" />
              Change password
            </Button>

            <Button
              type="button"
              variant="outline"
              size="icon"
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
              className="border-border bg-card text-foreground hover:bg-muted"
            >
              {theme === "dark" ? (
                <Sun className="size-4" aria-hidden="true" />
              ) : (
                <Moon className="size-4" aria-hidden="true" />
              )}
            </Button>

            <div className="flex size-9 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
              {initials}
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-foreground">
                {fullName}
              </p>
              <p className="text-xs text-muted-foreground">{roleLabel}</p>
              <p className="text-xs text-muted-foreground">{departmentLabel}</p>
            </div>
          </div>
        </div>
      </header>

      <main
        className={cn(
          "h-screen overflow-y-auto lg:ml-72",
          pathname === "/summaries" || pathname.startsWith("/reports")
            ? "pt-54 px-0 pb-0 sm:pt-40 sm:px-0 sm:pb-0 lg:pt-28"
            : "pt-56 px-5 pb-6 sm:px-6 sm:pb-8 lg:pt-36",
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
        <DialogContent>
          <DialogHeader>
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

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsChangePasswordOpen(false)}
                disabled={isChangingPassword}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isChangingPassword}>
                {isChangingPassword ? "Saving..." : "Change password"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
