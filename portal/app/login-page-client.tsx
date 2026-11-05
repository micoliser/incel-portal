"use client";

import { extractApiErrorMessage } from "@/lib/api-errors";
import axios from "axios";
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, AlertCircle, Clock } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { buildLoginPath, clearStoredTokens } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";
import { AuthShell } from "@/components/auth/AuthShell";

type LoginPageClientProps = {
  returnToPath: string | null;
  showInactivityAlert: boolean;
};

export default function LoginPageClient({
  returnToPath,
  showInactivityAlert,
}: LoginPageClientProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  useEffect(() => {
    async function checkAuth() {
      try {
        await apiClient.get("/me");
        router.replace(returnToPath ?? "/dashboard");
      } catch {
        setIsCheckingAuth(false);
      }
    }
    void checkAuth();
  }, [returnToPath, router]);

  function validateForm(values: { email: string; password: string }) {
    const nextErrors: { email?: string; password?: string } = {};
    const trimmedEmail = values.email.trim();

    if (!trimmedEmail) {
      nextErrors.email = "Email address is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextErrors.email = "Enter a valid email address.";
    }

    if (!values.password) {
      nextErrors.password = "Password is required.";
    } else if (values.password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters long.";
    }

    return nextErrors;
  }

  function dismissInactivityAlert() {
    try {
      window.localStorage.setItem(
        "portal_last_activity",
        String(Math.floor(Date.now() / 1000)),
      );
    } catch {
      // Ignore storage failures and just clear the modal state via URL.
    }

    router.replace(returnToPath ? buildLoginPath(returnToPath) : "/");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const validationErrors = validateForm({ email, password });
    setFieldErrors(validationErrors);
    setErrorMessage("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      await apiClient.post("/auth/login", {
        email: email.trim(),
        password,
      });

      clearStoredTokens();
      try {
        window.localStorage.setItem(
          "portal_last_activity",
          String(Math.floor(Date.now() / 1000)),
        );
      } catch {
        // Ignore storage failures; the session will still proceed.
      }
      router.replace(returnToPath ?? "/dashboard");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as
          | {
              attempts_remaining?: number;
            }
          | undefined;
        let message = extractApiErrorMessage(error, "Unable to sign in. Please try again.");

        if (responseData?.attempts_remaining !== undefined) {
          message += ` (${responseData.attempts_remaining} attempts remaining before lockout.)`;
        }

        setErrorMessage(message);
      } else {
        setErrorMessage(
          extractApiErrorMessage(error, "Network error. Please check your connection and try again.")
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleEmailChange(value: string) {
    setEmail(value);
    setFieldErrors((current) => {
      if (!current.email) return current;

      const nextErrors = { ...current };
      delete nextErrors.email;
      return nextErrors;
    });
    setErrorMessage("");
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setFieldErrors((current) => {
      if (!current.password) return current;

      const nextErrors = { ...current };
      delete nextErrors.password;
      return nextErrors;
    });
    setErrorMessage("");
  }

  if (isCheckingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-sm">
          <span className="size-2 rounded-full bg-[#0d47a1] animate-pulse" />
          Checking session...
        </div>
      </main>
    );
  }

  return (
    <AuthShell
      headline="Welcome back to your workspace."
      description="Sign in with your company email to access your department tools, approvals, workflows, and analytics."
    >
      <Dialog
        open={showInactivityAlert}
        onOpenChange={(open) => {
          if (!open) {
            dismissInactivityAlert();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Clock className="size-4.5" />}>
            <DialogTitle>Signed out due to inactivity</DialogTitle>
            <DialogDescription>
              For your security, your session timed out while you were away.
              Please sign in again to continue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end">
            <Button
              type="button"
              onClick={dismissInactivityAlert}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
            >
              Okay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-border bg-card shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="space-y-1.5 pb-6">
          <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
            Sign in
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Enter your company credentials to access your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            {errorMessage ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/10 p-3.5 text-xs text-[#dc2626] font-medium leading-relaxed animate-in fade-in-50 duration-200"
              >
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div className="flex-1">{errorMessage}</div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold text-foreground">
                Company Email Address
              </Label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
                  <Mail className="size-4" aria-hidden="true" />
                </div>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@incelgroup.com"
                  value={email}
                  onChange={(event) => handleEmailChange(event.target.value)}
                  autoComplete="email"
                  autoFocus
                  disabled={isSubmitting}
                  className="h-11 pl-10 pr-4 text-sm rounded-xl"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={
                    fieldErrors.email ? "email-error" : undefined
                  }
                />
              </div>
              {fieldErrors.email ? (
                <p id="email-error" className="text-xs text-[#dc2626] font-medium">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold text-foreground">
                  Password
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-[#0d47a1] hover:text-[#0a3880] dark:text-[#38bdf8] hover:underline transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
                  <Lock className="size-4" aria-hidden="true" />
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) =>
                    handlePasswordChange(event.target.value)
                  }
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  className="h-11 pl-10 pr-11 text-sm rounded-xl"
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={
                    fieldErrors.password ? "password-error" : undefined
                  }
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={
                    showPassword ? "Hide password" : "Show password"
                  }
                  title={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {fieldErrors.password ? (
                <p id="password-error" className="text-xs text-[#dc2626] font-medium">
                  {fieldErrors.password}
                </p>
              ) : null}
            </div>

            <div className="pt-2">
              <Button
                className="w-full h-11 rounded-xl font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white transition-all shadow-sm flex items-center justify-center gap-2 group cursor-pointer"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign in to Workspace</span>
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
