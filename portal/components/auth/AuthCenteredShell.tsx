"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { Sun, Moon, Lock } from "lucide-react";

type AuthCenteredShellProps = {
  children: ReactNode;
};

function getThemeSnapshot(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("portal_theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getThemeServerSnapshot(): "light" | "dark" {
  return "dark";
}

function subscribeTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    mql.removeEventListener("change", callback);
  };
}

const emptySubscribe = () => () => {};

export function AuthCenteredShell({ children }: AuthCenteredShellProps) {
  const isMounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try {
      window.localStorage.setItem("portal_theme", nextTheme);
    } catch {
      // Ignore storage errors
    }
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    window.dispatchEvent(new Event("storage"));
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between bg-background text-foreground overflow-x-hidden selection:bg-[#0d47a1] selection:text-white">
      {/* Top Utility Header */}
      <header className="relative z-20 flex items-center justify-between px-6 py-5 lg:px-12 w-full max-w-7xl mx-auto">
        <Link
          href="/"
          className="flex items-center gap-3 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-[#0d47a1] rounded-lg"
        >
          <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card p-1.5 shadow-xs">
            <Image
              src="/logo2.png"
              alt="Incel Group"
              width={32}
              height={32}
              className="object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-foreground leading-tight">
              Incel Workspace
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              Enterprise Operations
            </span>
          </div>
        </Link>

        {isMounted && (
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-[#0d47a1] cursor-pointer"
          >
            {theme === "dark" ? (
              <>
                <Sun className="size-3.5 text-amber-400" />
                <span>Light mode</span>
              </>
            ) : (
              <>
                <Moon className="size-3.5 text-[#0d47a1]" />
                <span>Dark mode</span>
              </>
            )}
          </button>
        )}
      </header>

      {/* Centered Main Form Container */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        <div className="w-full max-w-md space-y-6">
          {children}
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="relative z-10 py-6 text-center text-xs text-muted-foreground space-y-1.5">
        <p className="flex items-center justify-center gap-1.5">
          <Lock className="size-3 text-muted-foreground/70" />
          <span>Protected by 256-bit security encryption & audit verification</span>
        </p>
        <p>
          Incel Group &copy; {new Date().getFullYear()}. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
