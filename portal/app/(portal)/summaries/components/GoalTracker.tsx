"use client";

import React, { useState } from "react";
import { Target, Plus, Trash2, CheckCircle, AlertCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Goal {
  id: string;
  metric: string;
  target_value: number;
  period_start: string;
  period_end: string;
  is_active: boolean;
  created_at: string;
}

interface GoalProgress {
  metric: string;
  target: number;
  current: number;
  achieved: boolean;
  difference: number;
}

const GOAL_METRICS = [
  { value: "completion_rate", label: "Completion Rate (%)" },
  { value: "tasks_completed", label: "Tasks Completed" },
  { value: "high_priority_completed", label: "High Priority Tasks Completed" },
  { value: "on_time_completion_rate", label: "On-Time Completion Rate (%)" },
  { value: "comments_added", label: "Comments Added" },
];

interface GoalTrackerProps {
  goals?: Goal[];
  goalProgress?: Record<string, GoalProgress>;
  onAddGoal?: (goal: Goal) => void;
  onRemoveGoal?: (id: string) => void;
  loading?: boolean;
}

export function GoalTracker({
  goals = [],
  goalProgress,
  onAddGoal,
  onRemoveGoal,
  loading = false,
}: GoalTrackerProps) {
  const [showForm, setShowForm] = useState(false);
  const [metric, setMetric] = useState<string>("");
  const [targetValue, setTargetValue] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const handleAddGoal = async () => {
    if (!metric || !targetValue || !periodStart || !periodEnd) {
      toast.error("Please fill in all fields");
      return;
    }

    setSubmitting(true);
    try {
      // This would call the API
      if (onAddGoal) {
        const newGoal = {
          id: Date.now().toString(),
          metric,
          target_value: parseFloat(targetValue),
          period_start: periodStart,
          period_end: periodEnd,
          is_active: true,
          created_at: new Date().toISOString(),
        };
        onAddGoal(newGoal);
      }
      toast.success("Goal created successfully");
      setShowForm(false);
      setMetric("");
      setTargetValue("");
      setPeriodStart("");
      setPeriodEnd("");
    } catch (error) {
      toast.error("Failed to create goal");
    } finally {
      setSubmitting(false);
    }
  };

  const getMetricLabel = (metricValue: string) => {
    const found = GOAL_METRICS.find((m) => m.value === metricValue);
    return found?.label || metricValue;
  };

  const getProgressPercentage = (progress: GoalProgress) => {
    return (progress.current / progress.target) * 100;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5" />
              <div>
                <CardTitle>Goals & Targets</CardTitle>
                <CardDescription>
                  Set and track your productivity goals
                </CardDescription>
              </div>
            </div>
            <Button
              onClick={() => setShowForm(!showForm)}
              size="sm"
              variant={showForm ? "outline" : "default"}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Goal
            </Button>
          </div>
        </CardHeader>
      </Card>

      {showForm && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium block mb-2">Metric</label>
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select metric" />
                  </SelectTrigger>
                  <SelectContent>
                    {GOAL_METRICS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">
                  Target Value
                </label>
                <Input
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="e.g., 85 for 85%"
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium block mb-2">
                  End Date
                </label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddGoal} disabled={submitting}>
                {submitting ? "Creating..." : "Create Goal"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Goals */}
      {goals.length > 0 && (
        <div className="space-y-3">
          {goals.map((goal) => {
            const progress = goalProgress?.[goal.metric];
            const progressPercent = progress
              ? getProgressPercentage(progress)
              : 0;

            return (
              <Card key={goal.id}>
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium">
                          {getMetricLabel(goal.metric)}
                        </p>
                        <p className="text-sm text-gray-500">
                          {goal.period_start} to {goal.period_end}
                        </p>
                      </div>
                      {progress && (
                        <div className="flex items-center gap-2">
                          {progress.achieved ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : (
                            <AlertCircle className="w-5 h-5 text-yellow-600" />
                          )}
                          {onRemoveGoal && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onRemoveGoal(goal.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {progress && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span>
                            {progress.current} / {progress.target}
                          </span>
                          <span
                            className={
                              progress.achieved
                                ? "text-green-600 font-medium"
                                : "text-gray-600"
                            }
                          >
                            {Math.min(Math.round(progressPercent), 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className={`h-2 rounded-full transition-all ${
                              progress.achieved ? "bg-green-600" : "bg-blue-600"
                            }`}
                            style={{
                              width: `${Math.min(progressPercent, 100)}%`,
                            }}
                          />
                        </div>
                        {!progress.achieved && (
                          <p className="text-sm text-gray-600">
                            {progress.difference > 0
                              ? `+${progress.difference.toFixed(1)} to go`
                              : `${progress.difference.toFixed(1)} over target`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {goals.length === 0 && !showForm && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <Target className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 mb-2">No goals yet</p>
              <p className="text-sm text-gray-500 mb-4">
                Create your first goal to start tracking progress
              </p>
              <Button onClick={() => setShowForm(true)}>
                Create Your First Goal
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export const MemoizedGoalTracker = React.memo(GoalTracker);
