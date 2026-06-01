import { getSafeReturnPath } from "@/lib/auth";

import LoginPageClient from "./login-page-client";

type HomePageProps = {
  searchParams: Promise<{
    next?: string | string[];
    reason?: string | string[];
  }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { next, reason } = await searchParams;

  const nextParam = Array.isArray(next) ? next[0] : next;
  const reasonParam = Array.isArray(reason) ? reason[0] : reason;

  return (
    <LoginPageClient
      returnToPath={getSafeReturnPath(nextParam)}
      showInactivityAlert={reasonParam === "inactivity"}
    />
  );
}
