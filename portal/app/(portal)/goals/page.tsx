"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  CheckSquare2,
  Flame,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
} from "lucide-react";
import { toast } from "sonner";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractApiErrorMessage } from "@/lib/api-errors";
import {
  goalsAPI,
  type GoalMetric,
  type GoalsWeekResponse,
} from "@/lib/api/goals";
import { MemoizedGoalTracker } from "../summaries/components/GoalTracker";

const GOAL_METRICS: Array<{
  value: GoalMetric;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  {
    value: "tasks_completed",
    label: "Tasks Completed",
    icon: CheckSquare2,
    hint: "Total number of tasks finished this week",
  },
  {
    value: "high_priority_completed",
    label: "High Priority Tasks Completed",
    icon: Flame,
    hint: "Urgent & critical tasks resolved",
  },
  {
    value: "files_attached",
    label: "Files Attached",
    icon: Paperclip,
    hint: "Deliverables, assets, and task documentation",
  },
  {
    value: "comments_added",
    label: "Comments Added",
    icon: MessageSquare,
    hint: "Team communication and collaboration notes",
  },
];

export default function GoalsPage() {
  const [goalsResponse, setGoalsResponse] = useState<GoalsWeekResponse | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metric, setMetric] = useState<GoalMetric | "">("");
  const [targetValue, setTargetValue] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const weekLabel = useMemo(() => {
    if (!goalsResponse) {
      return "Current week";
    }

    return `${goalsResponse.week_start_date} to ${goalsResponse.week_end_date}`;
  }, [goalsResponse]);

  const activeGoalsCount = goalsResponse?.goals?.length ?? 0;
  const achievedGoalsCount =
    goalsResponse?.goals?.filter((g) => g.progress?.achieved).length ?? 0;

  const fetchGoals = async (isBackground = false) => {
    try {
      if (!isBackground) setRefreshing(true);
      const data = await goalsAPI.getGoalsForWeek();
      setGoalsResponse(data);
    } catch (error) {
      if (!isBackground) {
        toast.error(
          extractApiErrorMessage(
            error,
            "Failed to load goals for the current week",
          ),
        );
      }
      console.error(error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchGoals();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchGoals(true);
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  const handleCreateGoal = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!metric || !targetValue) {
      toast.error("Please choose a metric and enter a target value.");
      return;
    }

    const numValue = Number(targetValue);
    if (isNaN(numValue) || numValue <= 0) {
      toast.error("Target value must be a positive number.");
      return;
    }

    try {
      setSubmitting(true);
      await goalsAPI.createGoal({
        metric,
        target_value: numValue,
      });
      setMetric("");
      setTargetValue("");
      toast.success("Goal successfully created for this week.");
      await fetchGoals();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to create goal"));
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-12">
      {/* Top Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                <Target className="size-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Weekly Goals
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Define your focus targets for the week and monitor completion in real time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-border/80 bg-muted/50 px-3.5 py-1.5 text-xs font-medium text-foreground">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <Calendar className="size-3.5 text-muted-foreground" />
              <span className="tabular-nums">{weekLabel}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchGoals()}
              disabled={refreshing}
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              title="Refresh goals"
            >
              <RefreshCw
                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              <span className="ml-1.5 hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </div>

        {/* Overview Stats Strip */}
        {activeGoalsCount > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border/60 pt-6 sm:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Active Targets</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {activeGoalsCount}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Achieved</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {achievedGoalsCount}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-border/60 bg-muted/20 p-3.5 sm:col-span-1">
              <p className="text-xs font-medium text-muted-foreground">Completion Rate</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[#0d47a1] dark:text-[#38bdf8]">
                {Math.round((achievedGoalsCount / activeGoalsCount) * 100)}%
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Goal Creation & Principles Section */}
      <Card className="border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
            Set a Weekly Target
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground sm:text-sm">
            Select a metric and define a realistic target for your weekly output.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <form onSubmit={handleCreateGoal} className="flex flex-col justify-between space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="goal-metric" className="text-xs font-medium text-foreground">
                  Performance Metric
                </Label>
                <Select
                  value={metric}
                  onValueChange={(value) => setMetric(value as GoalMetric)}
                >
                  <SelectTrigger id="goal-metric" className="h-10 w-full text-sm">
                    <SelectValue placeholder="Choose metric..." />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_METRICS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <SelectItem key={item.value} value={item.value}>
                          <div className="flex items-center gap-2 py-0.5">
                            <Icon className="size-4 text-muted-foreground" />
                            <span>{item.label}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="goal-target" className="text-xs font-medium text-foreground">
                  Target Value
                </Label>
                <Input
                  id="goal-target"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  placeholder="e.g. 15"
                  className="h-10 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Tied automatically to the active calendar week.
              </p>
              <Button
                type="submit"
                disabled={submitting || !metric || !targetValue}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-xs"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 size-4" />
                    Set Goal
                  </>
                )}
              </Button>
            </div>
          </form>

          {/* Quick Guide Box */}
          <div className="flex flex-col justify-center rounded-xl border border-border/70 bg-muted/30 p-4.5 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">How Goals Operate</p>
            <div className="mt-3 space-y-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                  <CheckCircle2 className="size-3.5" />
                </div>
                <div>
                  <span className="font-medium text-foreground">Automatic Progress: </span>
                  Actions you take across tasks, attachments, and comments automatically increment goal progress.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Calendar className="size-3.5" />
                </div>
                <div>
                  <span className="font-medium text-foreground">Weekly Cycle: </span>
                  Goals remain active until Sunday midnight, after which they are finalized in your weekly report.
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Sparkles className="size-3.5" />
                </div>
                <div>
                  <span className="font-medium text-foreground">Summary Snapshot: </span>
                  Past summaries display a read-only record of your goals and final attainment.
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Goal Tracker List */}
      <MemoizedGoalTracker
        title="Active Goals for This Week"
        description="Live progress tracked directly against your system activity."
        goals={goalsResponse?.goals ?? []}
        loading={loading}
        showEmptyStateCta={false}
      />
    </div>
  );
}
