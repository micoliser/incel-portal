"use client";

import axios from "axios";
import { useEffect, useState } from "react";

/**
 * Too many wrong passwords lock an account for a while (sign-in, the chat
 * password step and changing the password share one count). The API answers
 * 403 `account_locked` with `retry_after` seconds; these helpers turn that
 * into a live countdown.
 */

const DEFAULT_WAIT_SECONDS = 15 * 60;

/** Seconds to wait if the error is a lockout, otherwise null. */
export function lockoutSeconds(error: unknown): number | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 403) return null;
  const body = error.response.data as
    | { error?: { type?: string; metadata?: { retry_after?: number | string } } }
    | undefined;
  if (body?.error?.type !== "account_locked") return null;
  const fromBody = Number(body.error.metadata?.retry_after);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(error.response.headers?.["retry-after"]);
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader);
  return DEFAULT_WAIT_SECONDS;
}

/** The time (ms since epoch) a lockout error ends, or null if it is not one. */
export function lockedUntilFrom(error: unknown): number | null {
  const seconds = lockoutSeconds(error);
  return seconds === null ? null : Date.now() + seconds * 1000;
}

/** "14:05", or "0:09" for the last seconds. */
export function formatWait(seconds: number) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconds left until `until`, updated every second; 0 once it has passed or when there is none. */
export function useSecondsLeft(until: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [until]);
  if (!until) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

export function lockoutText(secondsLeft: number) {
  return `Too many wrong passwords. Try again in ${formatWait(secondsLeft)}.`;
}
