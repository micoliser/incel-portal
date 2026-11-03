"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2, Mail } from "lucide-react";

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
              {isSuccess ? "Check your email" : "Forgot password?"}
            </CardTitle>
            <CardDescription>
              {isSuccess
                ? "We have dispatched a password reset link to your email."
                : "Enter your registered company email to receive a password reset link."}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {isSuccess ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-900 dark:text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Reset link dispatched</p>
                    <p className="text-xs text-muted-foreground">
                      If your account is active, you will receive an email at{" "}
                      <span className="font-medium text-foreground">{submittedEmail}</span>{" "}
                      with instructions to reset your password.
                    </p>
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground space-y-2">
                  <div className="flex items-center gap-1.5 font-medium text-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span>Next Steps</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>The link will expire in 60 minutes for security.</li>
                    <li>Check your spam or junk folder if it doesn&apos;t arrive shortly.</li>
                  </ul>
                </div>

                <div className="pt-2 flex flex-col gap-2">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setIsSuccess(false);
                      setEmail("");
                    }}
                  >
                    Send another link
                  </Button>
                  <Button asChild className="w-full">
                    <Link href="/">
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back to Sign in
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-4" onSubmit={handleSubmit} noValidate>
                {errorMessage && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 flex gap-2.5 items-start">
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-destructive font-medium leading-relaxed">
                      {errorMessage}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Work Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@incelgroup.com"
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    autoComplete="email"
                    autoFocus
                    disabled={isSubmitting}
                    aria-invalid={Boolean(fieldError)}
                    aria-describedby={fieldError ? "email-error" : undefined}
                  />
                  {fieldError ? (
                    <p id="email-error" className="text-xs text-destructive">
                      {fieldError}
                    </p>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  className="w-full font-medium"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending reset link...
                    </>
                  ) : (
                    "Send Reset Link"
                  )}
                </Button>

                <div className="pt-2 text-center">
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

