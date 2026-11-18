"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Sun,
  Moon,
  CheckCircle2,
  Lock,
} from "lucide-react";

type AuthShellProps = {
  headline?: string;
  description?: string;
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

export function AuthShell({
  headline = "Your work at Incel Group, in one place.",
  description = "Tasks, daily reports, company applications and support for Incel Group staff.",
  children,
}: AuthShellProps) {
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
    <div className="relative min-h-screen w-full flex flex-col bg-background text-foreground overflow-x-hidden selection:bg-[#0d47a1] selection:text-white">
      {/* Top utility bar with Theme Toggle */}
      <div className="absolute top-5 right-6 lg:right-10 z-40">
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
                <Moon className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" />
                <span>Dark mode</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Main split canvas */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-screen">
        {/* Left Side: Brand Command & Operational Showcase (Visible on lg+) */}
        {/* Plain Deep Blue (#0d47a1) solid background */}
        <section className="hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-12 lg:p-14 xl:p-18 relative bg-[#0d47a1] text-white border-r border-[#0d47a1]/30">
          {/* Top Brand Block - High contrast white text */}
          <Link
            href="/"
            className="relative z-10 flex items-center gap-3.5 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-white/40 rounded-xl"
          >
            <div className="flex size-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 p-2 shadow-xs">
              <Image
                src="/logo2.png"
                alt="Incel Group"
                width={32}
                height={32}
                className="object-contain"
              />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-bold tracking-tight text-white leading-tight">
                Incel Workspace
              </span>
              <span className="text-xs font-medium text-blue-100/90">
                Incel Group
              </span>
            </div>
          </Link>

          {/* Middle showcase content */}
          <div className="relative z-10 max-w-xl space-y-7 my-auto py-8">
            <h1 className="text-4xl xl:text-5xl font-bold tracking-tight text-white leading-[1.12]">
              {headline}
            </h1>

            <p className="text-base xl:text-lg text-blue-100/85 leading-relaxed">
              {description}
            </p>

            <ul className="space-y-2.5 text-sm text-blue-100">
              {[
                "Tasks with a review step, to-dos and weekly goals",
                "Daily reports and weekly summaries",
                "Company applications, support requests and the assets assigned to you",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-blue-200" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Right Side: Form Container - Plain solid background */}
        <section className="col-span-1 lg:col-span-6 xl:col-span-5 flex flex-col justify-center items-center px-6 py-16 lg:p-12 xl:p-16 relative bg-background">
          <div className="relative z-10 w-full max-w-md space-y-6">
            {/* Mobile Header: Brand visible only on mobile screens */}
            <div className="flex lg:hidden items-center justify-center gap-3 pb-2">
              <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card p-1.5 shadow-xs">
                <Image
                  src="/logo2.png"
                  alt="Incel Group"
                  width={30}
                  height={30}
                  className="object-contain"
                />
              </div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-bold tracking-tight text-foreground">
                  Incel Workspace
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  Incel Group
                </span>
              </div>
            </div>

            {children}

            {/* Bottom Support & Security Disclaimer */}
            <div className="text-center pt-2 space-y-1.5 text-xs text-muted-foreground">
              <p className="flex items-center justify-center gap-1.5">
                <Lock className="size-3 text-muted-foreground" />
                <span>Protected by automated inactivity lockout & audit monitoring</span>
              </p>
              <p>
                Incel Group &copy; {new Date().getFullYear()}. All rights reserved.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
