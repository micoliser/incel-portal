"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Minus, TrendingDown, TrendingUp, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ComparisonMetrics, WeeklySummary } from "@/lib/api/summaries";

interface DeltaProps {
  value: number | null | undefined;
  suffix?: string;
  decimals?: number;
  /** For figures where going down is good, such as review time. */
  lowerIsBetter?: boolean;
}

function Delta({ value, suffix = "", decimals = 0, lowerIsBetter = false }: DeltaProps) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const good = lowerIsBetter ? value < 0 : value > 0;
  const bad = lowerIsBetter ? value > 0 : value < 0;
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
        good && "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        bad && "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400",
        value === 0 && "border-border bg-muted/70 text-muted-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {value > 0 ? "+" : ""}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

interface RowProps {
  label: string;
  detail?: string;
  value: React.ReactNode;
  tone?: "warning" | "danger";
  delta?: React.ReactNode;
  showDeltaColumn: boolean;
}

function Row({ label, detail, value, tone, delta, showDeltaColumn }: RowProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <p
        className={cn(
          "text-right text-base font-bold tabular-nums text-foreground",
          tone === "warning" && "text-amber-700 dark:text-amber-400",
          tone === "danger" && "text-rose-700 dark:text-rose-400",
        )}
      >
        {value}
      </p>
      {showDeltaColumn && <div className="w-20 shrink-0 text-right sm:w-24">{delta}</div>}
    </div>
  );
}

interface DelegatedWorkCardProps {
  summary: WeeklySummary;
  comparison?: ComparisonMetrics | null;
  /** Shown to someone the summary was shared with: third person, no task link. */
  isSharedView?: boolean;
}

export function DelegatedWorkCard({ summary, comparison, isSharedView = false }: DelegatedWorkCardProps) {
  if (!summary.has_delegated_work) return null;

  const people = summary.delegated_people ?? 0;
  const waiting = summary.delegated_waiting_for_review ?? 0;
  const overdue = summary.delegated_overdue ?? 0;
  const reviewHours = summary.delegated_avg_review_hours;
  const hasComparison = !!comparison && comparison.delta_delegated_tasks_given !== undefined;
  const who = isSharedView ? "them" : "you";

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Users className="size-4.5" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-base font-semibold">
                {isSharedView ? `Work ${summary.user_name} delegated` : "Work you delegated"}
              </CardTitle>
              <CardDescription className="text-xs">
                Tasks given to other people. Tasks assigned to {who} are counted under own work.
              </CardDescription>
            </div>
          </div>
          {!isSharedView && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-lg text-xs" asChild>
              <Link href="/tasks?view=created">
                Tasks I assigned
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {hasComparison && (
          <div className="flex justify-end border-b border-border/60 pb-2 text-[11px] font-medium text-muted-foreground">
            <span className="w-20 text-right sm:w-24">vs last week</span>
          </div>
        )}
        <div className="divide-y divide-border/60">
          <Row
            label="Tasks given out"
            detail={`to ${people} ${people === 1 ? "person" : "people"}`}
            value={summary.delegated_tasks_given ?? 0}
            showDeltaColumn={hasComparison}
            delta={<Delta value={comparison?.delta_delegated_tasks_given} />}
          />
          <Row
            label="Completed"
            detail="of those open this week"
            value={`${summary.delegated_tasks_completed ?? 0} of ${summary.delegated_tasks_open_during_week ?? 0}`}
            showDeltaColumn={hasComparison}
            delta={<Delta value={comparison?.delta_delegated_tasks_completed} />}
          />
          <Row
            label="Completion rate"
            value={`${(summary.delegated_completion_rate_percent ?? 0).toFixed(1)}%`}
            showDeltaColumn={hasComparison}
            delta={<Delta value={comparison?.delta_delegated_completion_rate} decimals={1} suffix="%" />}
          />
          <Row
            label="Completed on time"
            value={`${(summary.delegated_on_time_completion_rate_percent ?? 0).toFixed(1)}%`}
            showDeltaColumn={hasComparison}
            delta={
              <Delta value={comparison?.delta_delegated_on_time_completion_rate} decimals={1} suffix="%" />
            }
          />
          <Row
            label="Reviews"
            detail={`${summary.delegated_reviews_approved ?? 0} approved, ${summary.delegated_reviews_sent_back ?? 0} sent back`}
            value={summary.delegated_reviews_total ?? 0}
            showDeltaColumn={hasComparison}
            delta={<Delta value={comparison?.delta_delegated_reviews} />}
          />
          <Row
            label="Average review time"
            detail="Submission to decision"
            value={typeof reviewHours === "number" ? `${reviewHours.toFixed(1)} h` : "—"}
            showDeltaColumn={hasComparison}
            delta={
              <Delta
                value={comparison?.delta_delegated_avg_review_hours}
                decimals={1}
                suffix=" h"
                lowerIsBetter
              />
            }
          />
          <Row
            label={`Waiting for ${isSharedView ? "their" : "your"} review`}
            detail="At week end"
            value={waiting}
            tone={waiting > 0 ? "warning" : undefined}
            showDeltaColumn={hasComparison}
          />
          <Row
            label="Overdue"
            detail="Past deadline at week end"
            value={overdue}
            tone={overdue > 0 ? "danger" : undefined}
            showDeltaColumn={hasComparison}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export const MemoizedDelegatedWorkCard = React.memo(DelegatedWorkCard);
