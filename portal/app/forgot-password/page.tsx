"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, Loader2, Mail, KeyRound } from "lucide-react";

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
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthCenteredShell } from "@/components/auth/AuthCenteredShell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  function handleEmailChange(value: string) {
    setEmail(value);
    if (fieldError) setFieldError(null);
    if (errorMessage) setErrorMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = email.trim();
    if (!trimmed) {
      setFieldError("Email address is required.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setFieldError("Please enter a valid email address.");
      return;
    }

    setFieldError(null);
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await requestPasswordReset(trimmed);
      setSubmittedEmail(trimmed);
      setIsSuccess(true);
    } catch (err: unknown) {
      const message = extractApiErrorMessage(
        err,
        "Unable to send reset link. Please check your email and try again.",
      );
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthCenteredShell>
      <Card className="border-border bg-card shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="space-y-3 pb-6">
          <div className="flex size-11 items-center justify-center rounded-xl border border-[#0d47a1]/20 bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8] shadow-xs">
            <KeyRound className="size-5" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {isSuccess ? "Check your email" : "Forgot your password?"}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground leading-relaxed">
              {isSuccess
                ? "We have dispatched a secure password reset link to your email."
                : "Enter your registered company email address and we'll send you instructions to reset your account password."}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          {isSuccess ? (
            <div className="space-y-5 animate-in fade-in-50 duration-200">
              <div className="flex items-start gap-3 rounded-xl border border-[#16a34a]/30 bg-[#16a34a]/10 p-4 text-[#16a34a] dark:text-[#4ade80]">
                <CheckCircle2 className="size-5 text-[#16a34a] dark:text-[#4ade80] mt-0.5 shrink-0" />
                <div className="text-xs space-y-1 text-foreground">
                  <p className="font-semibold text-sm">Reset link dispatched</p>
                  <p className="text-muted-foreground leading-relaxed">
                    If an active account exists for{" "}
                    <span className="font-semibold text-foreground underline decoration-[#16a34a]/50">
                      {submittedEmail}
                    </span>
                    , an email has been sent with instructions to set a new password.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4 text-xs text-muted-foreground space-y-2.5">
                <div className="flex items-center gap-2 font-semibold text-foreground">
                  <Mail className="size-4 text-[#0d47a1]" />
                  <span>Important Details</span>
                </div>
                <ul className="space-y-1.5 pl-1">
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-muted-foreground" />
                    <span>The link will automatically expire in 60 minutes for security.</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-muted-foreground" />
                    <span>Check your spam or junk folder if the message does not appear in your inbox shortly.</span>
                  </li>
                </ul>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                <Button
                  asChild
                  className="w-full h-11 rounded-xl font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Link href="/">
                    <ArrowLeft className="size-4" />
                    <span>Back to Sign in</span>
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-11 rounded-xl font-semibold border-border hover:bg-muted text-foreground transition-all cursor-pointer"
                  onClick={() => {
                    setIsSuccess(false);
                    setEmail("");
                  }}
                >
                  Send another link
                </Button>
              </div>
            </div>
          ) : (
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
                    onChange={(e) => handleEmailChange(e.target.value)}
                    autoComplete="email"
                    autoFocus
                    disabled={isSubmitting}
                    className="h-11 pl-10 pr-4 text-sm rounded-xl"
                    aria-invalid={Boolean(fieldError)}
                    aria-describedby={fieldError ? "email-error" : undefined}
                  />
                </div>
                {fieldError ? (
                  <p id="email-error" className="text-xs text-[#dc2626] font-medium">
                    {fieldError}
                  </p>
                ) : null}
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
                      <span>Sending reset link...</span>
                    </>
                  ) : (
                    <>
                      <span>Send Reset Link</span>
                      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </Button>
              </div>

              <div className="pt-2 text-center">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors py-1 focus:outline-none focus:underline"
                >
                  <ArrowLeft className="size-3.5" />
                  <span>Return to Sign in</span>
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthCenteredShell>
  );
}
