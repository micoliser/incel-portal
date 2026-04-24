"use client";

import axios from "axios";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  AppWindow,
  CheckSquare2,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  ScrollText,
  Sun,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearStoredTokens,
  getStoredAccessToken,
  getStoredRefreshToken,
} from "@/lib/auth";
import { apiClient } from "@/lib/api-client";

export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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

    if (!accessToken || !refreshToken) {
      router.replace("/");
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
          router.replace("/");
          return;
        }
        setUserInfo(null);
        setIsAdmin(false);
      } finally {
        setIsCheckingAuth(false);
      }
    }

    void loadUserContext();
  }, [router]);

  const pageHeader =
    pathname === "/applications"
      ? {
          title: "Applications",
          subtitle: "Browse and manage internal application access.",
        }
      : pathname === "/logs"
        ? {
            title: "Logs",
            subtitle: "Review audit events and activity history.",
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

  async function handleLogout() {
    const accessToken = getStoredAccessToken();
    const refreshToken = getStoredRefreshToken();

    try {
      if (accessToken && refreshToken) {
        await apiClient.post("/auth/logout", { refresh: refreshToken });
      }
    } finally {
      clearStoredTokens();
      router.replace("/");
    }
  }

  function handleCloseSidebar() {
    setIsSidebarOpen(false);
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
        <div className="mb-4 flex items-center justify-end lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCloseSidebar}
            aria-label="Close sidebar"
          >
            <X className="size-5" aria-hidden="true" />
          </Button>
        </div>

        <div className="flex items-center gap-3 rounded-2xl px-3 py-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-accent text-sm font-bold text-accent-foreground">
            IG
          </div>
          <div>
            <p className="text-base font-semibold leading-tight text-sidebar-foreground">
              Incel Group
            </p>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              Portal
            </p>
          </div>
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
            href="/tasks"
            onClick={handleCloseSidebar}
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-300",
              pathname === "/tasks"
                ? "translate-x-1 bg-accent text-accent-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary transition-opacity duration-300",
                pathname === "/tasks" ? "opacity-100" : "opacity-0",
              )}
              aria-hidden="true"
            />
            <CheckSquare2
              className={cn(
                "size-4 transition-transform duration-300",
                pathname === "/tasks" ? "scale-110" : "group-hover:scale-105",
              )}
              aria-hidden="true"
            />
            <span>Tasks</span>
          </Link>

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
          onClick={handleLogout}
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

      <main className="h-screen overflow-y-auto px-5 pb-6 pt-44 sm:px-6 sm:pb-8 sm:pt-40 lg:ml-72 lg:pt-36">
        {children}
      </main>
    </div>
  );
}
