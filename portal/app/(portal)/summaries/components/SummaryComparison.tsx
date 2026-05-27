"use client";

import React from "react";
import { TrendingUp, TrendingDown, Minus, Target } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { WeeklySummary, ComparisonMetrics } from "@/lib/api/summaries";

interface MetricComparisonProps {
  label: string;
  current: number;
  previous: number;
  delta: number | null | undefined;
  isTrend: boolean;
  format?: "percentage" | "count";
}

function MetricComparison({
  label,
  current,
  previous,
  delta,
  isTrend,
  format = "count",
}: MetricComparisonProps) {
  const formatNumber = (val: number | null | undefined) =>
    typeof val === "number" && Number.isFinite(val) ? val : null;

  const hasDelta = formatNumber(delta) !== null;
  const isPositive = hasDelta && (delta as number) > 0;
  const isNeutral = hasDelta && (delta as number) === 0;
  const TrendIcon = isPositive ? TrendingUp : TrendingDown;

  const displayCurrent =
    format === "percentage"
      ? formatNumber(current) !== null
        ? `${(current as number).toFixed(1)}%`
        : "—"
      : formatNumber(current) !== null
        ? current
        : "—";

  const displayPrevious =
    format === "percentage"
      ? formatNumber(previous) !== null
        ? `${(previous as number).toFixed(1)}%`
        : "—"
      : formatNumber(previous) !== null
        ? previous
        : "—";

  const displayDelta = (() => {
    if (format === "percentage") {
      const v = formatNumber(delta);
      return v !== null ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—";
    }
    const v = formatNumber(delta);
    return v !== null ? `${v > 0 ? "+" : ""}${v}` : "—";
  })();

  return (
    <div className="flex items-start justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
      <div>
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <p className="text-xs text-gray-500 mt-1">
          Previous: {displayPrevious}
        </p>
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold text-gray-500">{displayCurrent}</p>
        <div
          className={`flex items-center gap-1 mt-1 text-sm font-medium ${
            isNeutral
              ? "text-gray-500"
              : isPositive
                ? "text-green-600"
                : "text-red-600"
          }`}
        >
          {isNeutral ? (
            <Minus className="w-4 h-4" />
          ) : (
            <TrendIcon className="w-4 h-4" />
          )}
          {displayDelta}
        </div>
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

  const trendColor = {
    up: "text-green-600",
    down: "text-red-600",
    flat: "text-gray-600",
  }[comparison.trend];

  const trendLabel = {
    up: "📈 Improving",
    down: "📉 Declining",
    flat: "➡️ Steady",
  }[comparison.trend];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Week-over-Week Comparison
          </CardTitle>
          <CardDescription>
            {comparison.previous_week_start &&
              `Compared to week of ${comparison.previous_week_start}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trend indicator */}
          <div className={`p-4 rounded-lg ${trendColor}`}>
            <p className="font-semibold text-sm">{trendLabel}</p>
            {comparison.velocity_change_percent !== undefined && (
              <p className="text-sm opacity-90">
                Velocity: {comparison.velocity_change_percent > 0 ? "+" : ""}
                {Number.isFinite(comparison.velocity_change_percent)
                  ? `${comparison.velocity_change_percent.toFixed(1)}%`
                  : "—"}
              </p>
            )}
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <MetricComparison
              label="Completion Rate"
              current={current.completion_rate_percent || 0}
              previous={
                current.completion_rate_percent -
                  comparison.delta_completion_rate || 0
              }
              delta={comparison.delta_completion_rate}
              isTrend={true}
              format="percentage"
            />
            <MetricComparison
              label="Tasks Completed"
              current={current.tasks_completed || 0}
              previous={
                current.tasks_completed - comparison.delta_tasks_completed || 0
              }
              delta={comparison.delta_tasks_completed}
              isTrend={false}
            />
            <MetricComparison
              label="On-Time Completion"
              current={current.on_time_completion_rate_percent || 0}
              previous={
                current.on_time_completion_rate_percent -
                  comparison.delta_on_time_completion_rate || 0
              }
              delta={comparison.delta_on_time_completion_rate}
              isTrend={true}
              format="percentage"
            />
            <MetricComparison
              label="High Priority Completed"
              current={current.high_priority_completed || 0}
              previous={
                current.high_priority_completed -
                  comparison.delta_high_priority_completed || 0
              }
              delta={comparison.delta_high_priority_completed}
              isTrend={false}
            />
            <MetricComparison
              label="Comments"
              current={current.comments_added || 0}
              previous={current.comments_added - comparison.delta_comments || 0}
              delta={comparison.delta_comments}
              isTrend={false}
            />
            <MetricComparison
              label="Files Attached"
              current={current.files_attached || 0}
              previous={current.files_attached - comparison.delta_files || 0}
              delta={comparison.delta_files}
              isTrend={false}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export const MemoizedSummaryComparison = React.memo(SummaryComparison);
