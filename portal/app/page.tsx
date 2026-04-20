"use client";

import axios from "axios";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
import {
  clearStoredTokens,
  hasStoredTokens,
  setStoredTokens,
} from "@/lib/auth";
import { apiClient } from "@/lib/api-client";

export default function Home() {
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
    if (hasStoredTokens()) {
      router.replace("/dashboard");
      return;
    }

    setIsCheckingAuth(false);
  }, [router]);

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
      const response = await apiClient.post("/auth/login", {
        email: email.trim(),
        password,
      });

      const data = response.data as Record<string, unknown>;

      const tokens = data.tokens as
        | { access?: string; refresh?: string }
        | undefined;
      if (!tokens?.access || !tokens?.refresh) {
        setErrorMessage(
          "Login succeeded, but the server did not return tokens.",
        );
        return;
      }

      clearStoredTokens();
      setStoredTokens(tokens.access, tokens.refresh);
      router.replace("/dashboard");
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as
          | { error?: { message?: string }; detail?: string }
          | undefined;
        const message =
          responseData?.error?.message ??
          responseData?.detail ??
          (error.code === "ERR_NETWORK"
            ? "Network error. Please check your connection and try again."
            : "Unable to sign in. Please try again.");
        setErrorMessage(message);
      } else {
        setErrorMessage(
          "Network error. Please check your connection and try again.",
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
      <main className="flex min-h-screen items-center justify-center bg-background [background-image:radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_52%)] px-6 dark:[background-image:radial-gradient(circle_at_top,rgba(96,165,250,0.12),transparent_56%)]">
        <div className="rounded-full border border-border bg-card px-5 py-2 text-sm font-medium text-foreground shadow-sm">
          Checking session...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background [background-image:radial-gradient(circle_at_top,rgba(37,99,235,0.12),transparent_52%)] px-6 py-10 dark:[background-image:radial-gradient(circle_at_top,rgba(96,165,250,0.12),transparent_56%)]">
      <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="flex flex-col justify-center space-y-6 text-foreground">
          <div className="inline-flex w-fit items-center rounded-full border border-border bg-card/85 px-4 py-2 text-sm font-medium text-primary shadow-sm backdrop-blur">
            Incel Portal
          </div>
          <div className="space-y-4">
            <h1 className="max-w-xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Welcome back to the Portal.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              Sign in to access your department tools, view internal
              applications, and manage your work from one central place.
            </p>
          </div>
          <div className="grid max-w-xl gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur">
              Secure access
            </div>
            <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur">
              Department aware
            </div>
            <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur">
              Audit logged
            </div>
          </div>
        </section>

        <Card className="border-border bg-card backdrop-blur">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Use your company email and password to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(event) => handleEmailChange(event.target.value)}
                  autoComplete="email"
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={
                    fieldErrors.email ? "email-error" : undefined
                  }
                />
                {fieldErrors.email ? (
                  <p id="email-error" className="text-sm text-destructive">
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) =>
                      handlePasswordChange(event.target.value)
                    }
                    autoComplete="current-password"
                    className="pr-12"
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
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {fieldErrors.password ? (
                  <p id="password-error" className="text-sm text-destructive">
                    {fieldErrors.password}
                  </p>
                ) : null}
              </div>

              {errorMessage ? (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {errorMessage}
                </div>
              ) : null}

              <Button className="w-full" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
