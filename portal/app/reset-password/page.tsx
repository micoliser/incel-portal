"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
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
    <main className="flex min-h-screen items-center justify-center bg-background [background-image:radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_52%)] px-6 py-10 dark:[background-image:radial-gradient(circle_at_top,rgba(96,165,250,0.12),transparent_56%)]">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-center gap-2">
          <Image src="/logo2.png" alt="Incel Group" width={48} height={48} />
          <div className="inline-flex items-center rounded-full font-semibold text-lg text-primary shadow-sm backdrop-blur">
            Incel Workspace
          </div>
        </div>

        <Card className="border-border bg-card backdrop-blur shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight">
              {isSuccess
                ? "Password updated"
                : isValidating
                  ? "Verifying link..."
                  : !tokenValid
                    ? "Link Expired or Invalid"
                    : "Create new password"}
            </CardTitle>
            <CardDescription>
              {isSuccess
                ? "Your password has been updated successfully."
                : isValidating
                  ? "Please wait while we check your verification link."
                  : !tokenValid
                    ? "We could not verify this password reset link."
                    : maskedEmail
                      ? `Resetting password for ${maskedEmail}`
                      : "Choose a new strong password for your account."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isValidating ? (
              <div className="flex flex-col items-center justify-center py-8 space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">
                  Validating security token...
                </p>
              </div>
            ) : !tokenValid ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                  <AlertCircle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-semibold">Reset Link Ineligible</p>
                    <p className="text-xs text-muted-foreground">
                      {validationError ||
                        "This link has expired, was already used, or is invalid."}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <Button asChild className="w-full">
                    <Link href="/forgot-password">
                      Request a new reset link
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to Sign in
                    </Link>
                  </Button>
                </div>
              </div>
            ) : isSuccess ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="font-semibold">All set!</p>
                    <p className="text-xs text-muted-foreground">
                      You can now sign in to Incel Portal using your new password.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    className="w-full font-medium"
                    onClick={() => router.push("/")}
                  >
                    Proceed to Sign in
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                {submitError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex gap-2.5 items-start">
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive font-medium leading-relaxed">
                      {submitError}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
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
                      className="pr-10"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.newPassword)}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {fieldErrors.newPassword && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.newPassword}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <div className="relative">
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
                      className="pr-10"
                      disabled={isSubmitting}
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && (
                    <p className="text-xs text-destructive">
                      {fieldErrors.confirmPassword}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>Password Requirements</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-full ${
                        hasMinLength
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    <span
                      className={
                        hasMinLength ? "text-foreground font-medium" : ""
                      }
                    >
                      At least 8 characters
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-full ${
                        passwordsMatch
                          ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Check className="h-2.5 w-2.5" />
                    </span>
                    <span
                      className={
                        passwordsMatch ? "text-foreground font-medium" : ""
                      }
                    >
                      Passwords must match
                    </span>
                  </div>
                </div>

                <Button
                  type="submit"
                  className="w-full font-medium"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Updating password...
                    </>
                  ) : (
                    "Reset Password"
                  )}
                </Button>

                <div className="pt-1 text-center">
                  <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to Sign in
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-sm">
            Loading...
          </div>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

