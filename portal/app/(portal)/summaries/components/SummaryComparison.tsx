"use client";

import React from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  GitCompare,
  CheckSquare2,
  Clock,
  Flame,
  MessageSquare,
  Paperclip,
  Percent,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WeeklySummary, ComparisonMetrics } from "@/lib/api/summaries";

interface MetricComparisonProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  current: number;
  previous: number;
  delta: number | null | undefined;
  format?: "percentage" | "count";
}

function MetricComparisonCard({
  label,
  icon: Icon,
  current,
  previous,
  delta,
  format = "count",
}: MetricComparisonProps) {
  const isFiniteNumber = (v: number | null | undefined): v is number =>
    typeof v === "number" && Number.isFinite(v);

  const hasDelta = isFiniteNumber(delta);
  const isPositive = hasDelta && delta > 0;
  const isNegative = hasDelta && delta < 0;
  const isNeutral = hasDelta && delta === 0;

  const displayCurrent = isFiniteNumber(current)
    ? format === "percentage"
      ? `${current.toFixed(1)}%`
      : current
    : "—";

  const displayPrevious = isFiniteNumber(previous)
    ? format === "percentage"
      ? `${previous.toFixed(1)}%`
      : previous
    : "—";

  const displayDelta = (() => {
    if (!hasDelta) return "—";
    const sign = delta > 0 ? "+" : "";
    return format === "percentage"
      ? `${sign}${delta.toFixed(1)}%`
      : `${sign}${delta}`;
  })();

  return (
    <div className="flex flex-col justify-between rounded-xl border border-border/70 bg-card/60 p-3.5 transition-colors hover:border-border hover:bg-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-3.5" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>

        {hasDelta && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              isPositive &&
                "border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              isNegative &&
                "border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400",
              isNeutral && "border border-border bg-muted/70 text-muted-foreground",
            )}
          >
            {isPositive && <TrendingUp className="size-3" />}
            {isNegative && <TrendingDown className="size-3" />}
            {isNeutral && <Minus className="size-3" />}
            <span>{displayDelta}</span>
          </div>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <p className="text-2xl font-bold tabular-nums text-foreground">
          {displayCurrent}
        </p>
        <p className="text-xs text-muted-foreground">
          Prev: <span className="font-medium tabular-nums">{displayPrevious}</span>
        </p>
      </div>
    </div>
  );
}

interface SummaryComparisonProps {
  current: Pick<
    WeeklySummary,
    | "completion_rate_percent"
    | "tasks_completed"
    | "on_time_completion_rate_percent"
    | "high_priority_completed"
    | "comments_added"
    | "files_attached"
  >;
  comparison?: ComparisonMetrics;
}

export function SummaryComparison({
  current,
  comparison,
}: SummaryComparisonProps) {
  if (!comparison) {
    return null;
  }

  const trendConfig = {
    up: {
      label: "Improving Momentum",
      description: "Pace and completion increased compared to the previous week.",
      badgeClass:
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      icon: TrendingUp,
    },
    down: {
      label: "Lower Output",
      description: "Pace or completion eased compared to the previous week.",
      badgeClass: "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300",
      icon: TrendingDown,
    },
    flat: {
      label: "Consistent Velocity",
      description: "Output matches previous performance levels evenly.",
      badgeClass: "border-border bg-muted/60 text-muted-foreground",
      icon: Minus,
    },
  }[comparison.trend];

  const TrendIcon = trendConfig.icon;

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] dark:ring-[#0d47a1]/30">
              <GitCompare className="size-5" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                Week-over-Week Comparison
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground sm:text-sm">
                {comparison.previous_week_start
                  ? `Benchmarked against the week of ${comparison.previous_week_start}`
                  : "Benchmark against prior recorded week"}
              </CardDescription>
            </div>
          </div>

          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold",
              trendConfig.badgeClass,
            )}
          >
            <TrendIcon className="size-4" />
            <span>{trendConfig.label}</span>
            {comparison.velocity_change_percent !== undefined &&
              Number.isFinite(comparison.velocity_change_percent) && (
                <span className="tabular-nums font-bold">
                  ({comparison.velocity_change_percent > 0 ? "+" : ""}
                  {comparison.velocity_change_percent.toFixed(1)}% velocity)
                </span>
              )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <MetricComparisonCard
            label="Completion Rate"
            icon={Percent}
            current={current.completion_rate_percent || 0}
            previous={
              (current.completion_rate_percent || 0) -
              (comparison.delta_completion_rate || 0)
            }
            delta={comparison.delta_completion_rate}
            format="percentage"
          />
          <MetricComparisonCard
            label="Tasks Completed"
            icon={CheckSquare2}
            current={current.tasks_completed || 0}
            previous={
              (current.tasks_completed || 0) -
              (comparison.delta_tasks_completed || 0)
            }
            delta={comparison.delta_tasks_completed}
          />
          <MetricComparisonCard
            label="On-Time Rate"
            icon={Clock}
            current={current.on_time_completion_rate_percent || 0}
            previous={
              (current.on_time_completion_rate_percent || 0) -
              (comparison.delta_on_time_completion_rate || 0)
            }
            delta={comparison.delta_on_time_completion_rate}
            format="percentage"
          />
          <MetricComparisonCard
            label="High Priority Tasks"
            icon={Flame}
            current={current.high_priority_completed || 0}
            previous={
              (current.high_priority_completed || 0) -
              (comparison.delta_high_priority_completed || 0)
            }
            delta={comparison.delta_high_priority_completed}
          />
          <MetricComparisonCard
            label="Comments Added"
            icon={MessageSquare}
            current={current.comments_added || 0}
            previous={
              (current.comments_added || 0) - (comparison.delta_comments || 0)
            }
            delta={comparison.delta_comments}
          />
          <MetricComparisonCard
            label="Files Attached"
            icon={Paperclip}
            current={current.files_attached || 0}
            previous={
              (current.files_attached || 0) - (comparison.delta_files || 0)
            }
            delta={comparison.delta_files}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export const MemoizedSummaryComparison = React.memo(SummaryComparison);
