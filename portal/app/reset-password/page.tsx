"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  ShieldAlert,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { confirmPasswordReset, validatePasswordResetToken } from "@/lib/api/auth";
import { AuthCenteredShell } from "@/components/auth/AuthCenteredShell";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const uid = searchParams.get("uid") || "";
  const token = searchParams.get("token") || "";

  const [isValidating, setIsValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [validationError, setValidationError] = useState("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<{
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    async function checkToken() {
      if (!uid || !token) {
        setIsValidating(false);
        setTokenValid(false);
        setValidationError(
          "This password reset link is invalid or incomplete. Please request a new link.",
        );
        return;
      }

      try {
        const res = await validatePasswordResetToken(uid, token);
        if (res.valid) {
          setTokenValid(true);
          setMaskedEmail(res.email || null);
        } else {
          setTokenValid(false);
          setValidationError(
            res.detail || "This reset link is invalid or has expired.",
          );
        }
      } catch (err: unknown) {
        setTokenValid(false);
        const msg = extractApiErrorMessage(
          err,
          "This password reset link is invalid or has expired.",
        );
        setValidationError(msg);
      } finally {
        setIsValidating(false);
      }
    }

    void checkToken();
  }, [uid, token]);

  const hasMinLength = newPassword.length >= 8;
  const passwordsMatch = Boolean(newPassword && newPassword === confirmPassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: { newPassword?: string; confirmPassword?: string } = {};
    if (!newPassword) {
      nextErrors.newPassword = "New password is required.";
    } else if (newPassword.length < 8) {
      nextErrors.newPassword = "Password must be at least 8 characters.";
    }

    if (!confirmPassword) {
      nextErrors.confirmPassword = "Confirm password is required.";
    } else if (newPassword !== confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }

    setFieldErrors({});
    setSubmitError("");
    setIsSubmitting(true);

    try {
      await confirmPasswordReset({
        uid,
        token,
        new_password: newPassword,
      });
      setIsSuccess(true);
    } catch (err: unknown) {
      const msg = extractApiErrorMessage(
        err,
        "Failed to reset password. The link may have expired.",
      );
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCenteredShell>
      <Card className="border-border bg-card shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#0d47a1]/20 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8] shadow-xs">
            <Lock className="size-5" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {isSuccess
                ? "Password updated"
                : isValidating
                  ? "Verifying reset link..."
                  : !tokenValid
                    ? "Invalid reset link"
                    : "Create new password"}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground leading-relaxed">
              {isSuccess
                ? "Your password has been changed successfully. You can now log in."
                : isValidating
                  ? "Checking the validity of your verification token..."
                  : !tokenValid
                    ? "We could not verify this password reset link."
                    : maskedEmail
                      ? `Configuring a secure password for ${maskedEmail}`
                      : "Choose a new strong password with at least 8 characters."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {isValidating ? (
            <div className="flex flex-col items-center justify-center py-10 space-y-3">
              <Loader2 className="size-8 animate-spin text-[#0d47a1]" />
              <p className="text-xs text-muted-foreground font-medium">
                Validating security credentials...
              </p>
            </div>
          ) : !tokenValid ? (
            <div className="space-y-5 animate-in fade-in-50 duration-200">
              <div className="flex items-start gap-3 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/10 p-4 text-[#dc2626]">
                <ShieldAlert className="size-5 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-sm">Reset link expired or invalid</p>
                  <p className="leading-relaxed">
                    {validationError ||
                      "This link has expired, was already used, or is incomplete. Please request a new reset link."}
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 pt-2">
                <Button
                  asChild
                  className="w-full h-11 rounded-xl font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Link href="/forgot-password">
                    <span>Request a new link</span>
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold border-border hover:bg-muted text-foreground transition-all cursor-pointer"
                >
                  <Link href="/">
                    <ArrowLeft className="mr-2 size-4" />
                    Back to Sign in
                  </Link>
                </Button>
              </div>
            </div>
          ) : isSuccess ? (
            <div className="space-y-5 animate-in fade-in-50 duration-200">
              <div className="flex items-start gap-3 rounded-xl border border-[#16a34a]/30 bg-[#16a34a]/10 p-4 text-[#16a34a] dark:text-[#4ade80]">
                <CheckCircle2 className="size-5 text-[#16a34a] dark:text-[#4ade80] mt-0.5 shrink-0" />
                <div className="text-xs space-y-1 text-foreground">
                  <p className="font-semibold text-sm">Credentials Updated Successfully</p>
                  <p className="text-muted-foreground leading-relaxed">
                    You can now sign in to Incel Workspace using your newly created password.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  className="w-full h-11 rounded-xl font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white transition-all shadow-sm flex items-center justify-center gap-2 group cursor-pointer"
                  onClick={() => router.push("/")}
                >
                  <span>Proceed to Sign in</span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit} noValidate>
              {submitError ? (
                <div
                  role="alert"
                  className="flex items-start gap-3 rounded-xl border border-[#dc2626]/30 bg-[#dc2626]/10 p-3.5 text-xs text-[#dc2626] font-medium leading-relaxed animate-in fade-in-50 duration-200"
                >
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <div className="flex-1">{submitError}</div>
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="newPassword" className="text-xs font-semibold text-foreground">
                  New Password
                </Label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
                    <Lock className="size-4" aria-hidden="true" />
                  </div>
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (fieldErrors.newPassword) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          newPassword: undefined,
                        }));
                      }
                    }}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                    className="h-11 pl-10 pr-11 text-sm rounded-xl"
                    aria-invalid={Boolean(fieldErrors.newPassword)}
                    aria-describedby={
                      fieldErrors.newPassword ? "newPassword-error" : undefined
                    }
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.newPassword ? (
                  <p id="newPassword-error" className="text-xs text-[#dc2626] font-medium">
                    {fieldErrors.newPassword}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-xs font-semibold text-foreground">
                  Confirm New Password
                </Label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-muted-foreground">
                    <Lock className="size-4" aria-hidden="true" />
                  </div>
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (fieldErrors.confirmPassword) {
                        setFieldErrors((prev) => ({
                          ...prev,
                          confirmPassword: undefined,
                        }));
                      }
                    }}
                    autoComplete="new-password"
                    disabled={isSubmitting}
                    className="h-11 pl-10 pr-11 text-sm rounded-xl"
                    aria-invalid={Boolean(fieldErrors.confirmPassword)}
                    aria-describedby={
                      fieldErrors.confirmPassword ? "confirmPassword-error" : undefined
                    }
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                    aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {fieldErrors.confirmPassword ? (
                  <p id="confirmPassword-error" className="text-xs text-[#dc2626] font-medium">
                    {fieldErrors.confirmPassword}
                  </p>
                ) : null}
              </div>

              {/* Password Requirements Checklist */}
              <div className="rounded-xl border border-border bg-muted/40 p-3.5 space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5 font-semibold text-foreground">
                  <KeyRound className="size-3.5 text-[#0d47a1]" />
                  <span>Security Requirements</span>
                </div>
                <div className="space-y-1.5 pl-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center size-4 rounded-full transition-colors ${
                        hasMinLength
                          ? "bg-[#16a34a]/20 text-[#16a34a] dark:text-[#4ade80]"
                          : "bg-muted-foreground/20 text-muted-foreground"
                      }`}
                    >
                      <Check className="size-2.5 stroke-[2.5]" />
                    </span>
                    <span className={hasMinLength ? "text-foreground font-medium" : ""}>
                      At least 8 characters in length
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center size-4 rounded-full transition-colors ${
                        passwordsMatch
                          ? "bg-[#16a34a]/20 text-[#16a34a] dark:text-[#4ade80]"
                          : "bg-muted-foreground/20 text-muted-foreground"
                      }`}
                    >
                      <Check className="size-2.5 stroke-[2.5]" />
                    </span>
                    <span className={passwordsMatch ? "text-foreground font-medium" : ""}>
                      Both passwords match
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 rounded-xl font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white transition-all shadow-sm flex items-center justify-center gap-2 group cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      <span>Updating password...</span>
                    </>
                  ) : (
                    <>
                      <span>Reset Password</span>
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </div>

              <div className="pt-1 text-center">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1 focus:outline-none focus:underline"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Back to Sign in</span>
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthCenteredShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-sm">
            <span className="size-2 rounded-full bg-[#0d47a1] animate-pulse" />
            Loading authentication session...
          </div>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
