"use client";

import React, { useMemo } from "react";
import {
  CheckCircle2,
  Clock,
  Target,
  CheckSquare2,
  Flame,
  Paperclip,
  MessageSquare,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { GoalProgress, GoalRecord } from "@/lib/api/goals";

interface GoalTrackerProps {
  title?: string;
  description?: string;
  goals?: GoalRecord[];
  loading?: boolean;
  showEmptyStateCta?: boolean;
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  emptyStateCtaLabel?: string;
  onEmptyStateCtaClick?: () => void;
}

const GOAL_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    accentClass: string;
    iconBgClass: string;
  }
> = {
  tasks_completed: {
    label: "Tasks Completed",
    icon: CheckSquare2,
    accentClass: "text-[#0d47a1] dark:text-[#38bdf8]",
    iconBgClass: "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]",
  },
  high_priority_completed: {
    label: "High Priority Tasks",
    icon: Flame,
    accentClass: "text-rose-600 dark:text-rose-400",
    iconBgClass: "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400",
  },
  files_attached: {
    label: "Files Attached",
    icon: Paperclip,
    accentClass: "text-sky-600 dark:text-sky-400",
    iconBgClass: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
  },
  comments_added: {
    label: "Comments Added",
    icon: MessageSquare,
    accentClass: "text-indigo-600 dark:text-indigo-400",
    iconBgClass: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400",
  },
};

function getMetricConfig(metricValue: string) {
  return (
    GOAL_CONFIG[metricValue] || {
      label: metricValue.replace(/_/g, " "),
      icon: Target,
      accentClass: "text-primary",
      iconBgClass: "bg-primary/10 text-primary",
    }
  );
}

function getProgressPercentage(progress: GoalProgress) {
  if (!progress.target || progress.target <= 0) return 0;
  return Math.min(Math.round((progress.current / progress.target) * 100), 100);
}

export function GoalTracker({
  title = "Weekly Goals",
  description = "Active goals and progress for this week",
  goals = [],
  loading = false,
  showEmptyStateCta = false,
  emptyStateTitle = "No goals set for this week",
  emptyStateDescription = "Create a weekly goal to focus your work and track progress automatically.",
  emptyStateCtaLabel = "Set a Goal",
  onEmptyStateCtaClick,
}: GoalTrackerProps) {
  const hasGoals = goals.length > 0;

  const stats = useMemo(() => {
    if (!goals.length) return null;
    const total = goals.length;
    const achieved = goals.filter((g) => g.progress?.achieved).length;
    const overallPct = Math.round(
      goals.reduce((acc, g) => {
        if (!g.progress?.target) return acc;
        return acc + Math.min(100, (g.progress.current / g.progress.target) * 100);
      }, 0) / total,
    );
    return { total, achieved, overallPct };
  }, [goals]);

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] dark:ring-[#0d47a1]/30">
              <Target className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                {title}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground sm:text-sm">
                {description}
              </CardDescription>
            </div>
          </div>

          {stats && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/60 px-3 py-1 text-xs font-medium text-foreground">
                <span className="size-2 rounded-full bg-[#0d47a1] dark:bg-[#38bdf8]" />
                <span className="tabular-nums font-semibold">{stats.achieved}</span>
                <span className="text-muted-foreground">of</span>
                <span className="tabular-nums font-semibold">{stats.total}</span>
                <span className="text-muted-foreground">achieved</span>
              </div>
              <div
                className={cn(
                  "flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tabular-nums",
                  stats.overallPct >= 100
                    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "border-border/80 bg-muted/60 text-foreground",
                )}
              >
                <span>{stats.overallPct}%</span>
                <span className="text-[11px] font-normal text-muted-foreground">avg pace</span>
              </div>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-4 py-4">
            {[1, 2].map((idx) => (
              <div
                key={idx}
                className="animate-pulse space-y-3 rounded-xl border border-border/60 bg-muted/30 p-4"
              >
                <div className="flex justify-between">
                  <div className="h-4 w-40 rounded bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                </div>
                <div className="h-2 w-full rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : hasGoals ? (
          <div className="divide-y divide-border/60">
            {goals.map((goal) => {
              const config = getMetricConfig(goal.metric);
              const MetricIcon = config.icon;
              const progress = goal.progress;
              const progressPercent = progress ? getProgressPercentage(progress) : 0;
              const isAchieved = progress?.achieved ?? false;

              return (
                <div
                  key={goal.id}
                  className="group relative flex flex-col gap-4 py-4.5 transition-colors first:pt-1 last:pb-1"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                          config.iconBgClass,
                        )}
                      >
                        <MetricIcon className="size-4.5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            {config.label}
                          </p>
                          {isAchieved ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="size-3" />
                              Achieved
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              <Clock className="size-3" />
                              In Progress
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Target: {goal.target_value} · Period: {goal.period_start} to{" "}
                          {goal.period_end}
                        </p>
                      </div>
                    </div>

                    {progress && (
                      <div className="flex items-baseline gap-2 self-start sm:self-auto sm:text-right">
                        <span className="text-base font-bold tabular-nums text-foreground">
                          {progress.current}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          / {progress.target}
                        </span>
                        <span
                          className={cn(
                            "ml-1 text-sm font-semibold tabular-nums",
                            isAchieved
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground",
                          )}
                        >
                          ({progressPercent}%)
                        </span>
                      </div>
                    )}
                  </div>

                  {progress ? (
                    <div className="space-y-1.5">
                      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/80">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500 ease-out",
                            isAchieved
                              ? "bg-emerald-500 dark:bg-emerald-400"
                              : "bg-[#0d47a1] dark:bg-[#38bdf8]",
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {isAchieved
                            ? "Weekly target completed"
                            : progress.difference > 0
                              ? `${progress.difference.toFixed(0)} remaining to reach goal`
                              : `${Math.abs(progress.difference).toFixed(0)} past target`}
                        </span>
                        <span className="tabular-nums font-medium">
                          {progress.current} of {progress.target}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Progress tracking will calibrate as relevant activity is recorded.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 py-10 px-4 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Sparkles className="size-6" />
            </div>
            <h3 className="mt-3 text-sm font-semibold text-foreground">
              {emptyStateTitle}
            </h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {emptyStateDescription}
            </p>
            {showEmptyStateCta && onEmptyStateCtaClick && (
              <Button
                onClick={onEmptyStateCtaClick}
                size="sm"
                className="mt-4 bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-xs"
              >
                {emptyStateCtaLabel}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const MemoizedGoalTracker = React.memo(GoalTracker);
