"use client";

import React from "react";
import { AlertCircle, CheckCircle, Target } from "lucide-react";

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

const GOAL_LABELS: Record<string, string> = {
  tasks_completed: "Tasks Completed",
  high_priority_completed: "High Priority Tasks Completed",
  files_attached: "Files Attached",
  comments_added: "Comments Added",
};

function getMetricLabel(metricValue: string) {
  return GOAL_LABELS[metricValue] || metricValue;
}

function getProgressPercentage(progress: GoalProgress) {
  if (!progress.target) return 0;
  return (progress.current / progress.target) * 100;
}

export function GoalTracker({
  title = "Goals",
  description = "Current week goals and progress",
  goals = [],
  loading = false,
  showEmptyStateCta = false,
  emptyStateTitle = "No goals yet",
  emptyStateDescription = "Create a goal for the current week to start tracking progress.",
  emptyStateCtaLabel = "Create goal",
  onEmptyStateCtaClick,
}: GoalTrackerProps) {
  const hasGoals = goals.length > 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200">
              <Target className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading goals...
          </CardContent>
        </Card>
      ) : hasGoals ? (
        <div className="space-y-3">
          {goals.map((goal) => {
            const progress = goal.progress;
            const progressPercent = progress
              ? getProgressPercentage(progress)
              : 0;

            return (
              <Card key={goal.id}>
                <CardContent className="pt-6">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {getMetricLabel(goal.metric)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Week of {goal.period_start} to {goal.period_end}
                        </p>
                      </div>
                      {progress ? (
                        <div className="flex items-center gap-2">
                          {progress.achieved ? (
                            <CheckCircle className="size-5 text-emerald-600" />
                          ) : (
                            <AlertCircle className="size-5 text-amber-600" />
                          )}
                        </div>
                      ) : null}
                    </div>

                    {progress ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium text-foreground">
                            {progress.current} / {progress.target}
                          </span>
                          <span
                            className={cn(
                              "font-semibold",
                              progress.achieved
                                ? "text-emerald-600"
                                : "text-muted-foreground",
                            )}
                          >
                            {Math.min(Math.round(progressPercent), 100)}%
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className={cn(
                              "h-2 rounded-full transition-all",
                              progress.achieved
                                ? "bg-emerald-600"
                                : "bg-blue-600",
                            )}
                            style={{
                              width: `${Math.min(progressPercent, 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {progress.achieved
                            ? "Goal achieved for this week"
                            : progress.difference > 0
                              ? `${progress.difference.toFixed(1)} to go`
                              : `${Math.abs(progress.difference).toFixed(1)} over target`}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Progress is not available for this goal yet.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <Target className="mx-auto mb-3 size-12 text-slate-300" />
            <p className="mb-2 text-sm font-medium text-foreground">
              {emptyStateTitle}
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              {emptyStateDescription}
            </p>
            {showEmptyStateCta && onEmptyStateCtaClick ? (
              <Button onClick={onEmptyStateCtaClick}>
                {emptyStateCtaLabel}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const MemoizedGoalTracker = React.memo(GoalTracker);
