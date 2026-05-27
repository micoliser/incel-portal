"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

import {
  goalsAPI,
  type GoalMetric,
  type GoalsWeekResponse,
} from "@/lib/api/goals";
import { MemoizedGoalTracker } from "../summaries/components/GoalTracker";

const GOAL_METRICS: Array<{ value: GoalMetric; label: string }> = [
  { value: "tasks_completed", label: "Tasks Completed" },
  { value: "high_priority_completed", label: "High Priority Tasks Completed" },
  { value: "files_attached", label: "Files Attached" },
  { value: "comments_added", label: "Comments Added" },
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

  const fetchGoals = async () => {
    try {
      setRefreshing(true);
      const data = await goalsAPI.getGoalsForWeek();
      setGoalsResponse(data);
    } catch (error) {
      toast.error("Failed to load goals for the current week");
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
      void fetchGoals();
    }, 30000);

    return () => window.clearInterval(interval);
  }, []);

  const handleCreateGoal = async () => {
    if (!metric || !targetValue) {
      toast.error("Please choose a metric and target value");
      return;
    }

    try {
      setSubmitting(true);
      await goalsAPI.createGoal({
        metric,
        target_value: Number(targetValue),
      });
      setMetric("");
      setTargetValue("");
      toast.success("Goal created for this week");
      await fetchGoals();
    } catch (error) {
      toast.error("Failed to create goal");
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <Card className="border-border/70 bg-card/95 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">Weekly Goals</CardTitle>
              <CardDescription>
                Create goals for the current week and watch progress update as
                you work.
              </CardDescription>
            </div>
            <div className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {refreshing ? "Refreshing..." : weekLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1.3fr_0.9fr]">
          <div className="grid gap-4 rounded-2xl border border-border bg-background/70 p-4">
            <div className="grid gap-1">
              <p className="text-sm font-semibold text-foreground">
                Create a goal
              </p>
              <p className="text-sm text-muted-foreground">
                Goals are always tied to the current week automatically.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Metric</label>
                <Select
                  value={metric}
                  onValueChange={(value) => setMetric(value as GoalMetric)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_METRICS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Target value</label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={targetValue}
                  onChange={(event) => setTargetValue(event.target.value)}
                  placeholder="e.g. 85"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleCreateGoal()}
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-2 size-4" />
                )}
                Create goal
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-slate-50 p-4 text-sm text-muted-foreground dark:bg-slate-900/40">
            <p className="font-semibold text-foreground">How it works</p>
            <ul className="mt-3 space-y-2">
              <li>• Goals are saved for the current week only.</li>
              <li>• Progress updates as you complete tasks and activity.</li>
              <li>
                • Past week summaries show a read-only snapshot of the goals you
                set.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <MemoizedGoalTracker
        title="Current Week Goals"
        description="Your active goals and live progress for the week."
        goals={goalsResponse?.goals ?? []}
        loading={loading}
        showEmptyStateCta={false}
      />
    </div>
  );
}
