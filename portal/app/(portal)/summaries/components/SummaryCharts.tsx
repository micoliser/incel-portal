"use client";

import React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertCircle, BarChart3, LineChart as LineChartIcon, PieChart as PieChartIcon } from "lucide-react";

interface SummaryData {
  week_start_date: string;
  completion_rate_percent: number;
  on_time_completion_rate_percent: number;
  tasks_completed: number;
  tasks_assigned: number;
  high_priority_completed: number;
  priority_distribution?: Record<string, number>;
  status_distribution?: Record<string, number>;
}

interface TrendChartProps {
  summaries: SummaryData[];
  loading?: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
  }>;
  label?: string;
  unit?: string;
}

function CustomTooltip({ active, payload, label, unit = "" }: CustomTooltipProps) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-border bg-popover/95 px-3.5 py-2.5 text-xs text-popover-foreground shadow-lg backdrop-blur-md">
        <p className="font-semibold text-foreground">{label}</p>
        <div className="mt-1.5 space-y-1">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}:
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {entry.value}
                {unit}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

export function CompletionTrendChart({ summaries }: TrendChartProps) {
  if (!summaries || summaries.length === 0) {
    return (
      <Card className="border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Completion Trend</CardTitle>
          <CardDescription className="text-xs">Your rate trajectory over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              <span>Not enough weekly data to calculate trends</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = summaries.map((summary) => ({
    name: new Date(summary.week_start_date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    "Completion Rate": summary.completion_rate_percent,
    "On-Time Rate": summary.on_time_completion_rate_percent,
  }));

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
            <LineChartIcon className="size-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Completion Trend
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Overall completion and on-time performance across recent weeks
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(150,150,150,0.15)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "currentColor" }}
                stroke="rgba(150,150,150,0.3)"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "currentColor" }}
                stroke="rgba(150,150,150,0.3)"
                unit="%"
                domain={[0, 100]}
              />
              <Tooltip content={<CustomTooltip unit="%" />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                iconType="circle"
              />
              <Line
                type="monotone"
                dataKey="Completion Rate"
                stroke="#0d47a1"
                strokeWidth={2.5}
                dot={{ fill: "#0d47a1", r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="On-Time Rate"
                stroke="#16a34a"
                strokeWidth={2.5}
                dot={{ fill: "#16a34a", r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function TasksCompletedChart({ summaries }: TrendChartProps) {
  if (!summaries || summaries.length === 0) {
    return (
      <Card className="border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Tasks Completed</CardTitle>
          <CardDescription className="text-xs">Weekly task completion volume</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              <span>Not enough activity records to display volume</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = summaries.map((summary) => ({
    name: new Date(summary.week_start_date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    Completed: summary.tasks_completed,
    Assigned: summary.tasks_assigned,
  }));

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <BarChart3 className="size-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Task Volume Trend
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Assigned vs completed tasks by week
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(150,150,150,0.15)" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "currentColor" }}
                stroke="rgba(150,150,150,0.3)"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "currentColor" }}
                stroke="rgba(150,150,150,0.3)"
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                iconType="circle"
              />
              <Bar dataKey="Assigned" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Completed" fill="#0d47a1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "#dc2626",
  medium: "#d97706",
  low: "#16a34a",
};

export function PriorityDistributionChart({
  distribution,
}: {
  distribution: Record<string, number>;
}) {
  const hasData = distribution && Object.values(distribution).some((v) => v > 0);

  if (!hasData) {
    return (
      <Card className="border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Priority Distribution</CardTitle>
          <CardDescription className="text-xs">Tasks broken down by urgency</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              <span>No priority records found for this week</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = Object.entries(distribution).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    key: name.toLowerCase(),
  }));

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <PieChartIcon className="size-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Priority Distribution
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Breakdown of work by task urgency
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={PRIORITY_COLORS[entry.key] || "#0d47a1"}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip unit=" tasks" />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#d97706",
  in_progress: "#0d47a1",
  completed: "#16a34a",
};

export function StatusDistributionChart({
  distribution,
}: {
  distribution: Record<string, number>;
}) {
  const hasData = distribution && Object.values(distribution).some((v) => v > 0);

  if (!hasData) {
    return (
      <Card className="border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Status Distribution</CardTitle>
          <CardDescription className="text-xs">Tasks by lifecycle state</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4" />
              <span>No status data recorded for this week</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = Object.entries(distribution).map(([name, value]) => ({
    name: name.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    value,
    key: name.toLowerCase(),
  }));

  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <PieChartIcon className="size-4" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold text-foreground">
              Status Distribution
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground">
              Breakdown by active execution phase
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.name}
                    fill={STATUS_COLORS[entry.key] || "#0d47a1"}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip unit=" tasks" />} />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="circle"
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

interface SummaryChartsProps {
  summaryData?: SummaryData;
  historicalData?: SummaryData[];
  loading?: boolean;
}

export function SummaryCharts({
  summaryData,
  historicalData = [],
  loading = false,
}: SummaryChartsProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[1, 2].map((i) => (
          <Card key={i} className="animate-pulse border-border/80 bg-card p-6">
            <div className="h-4 w-1/3 rounded bg-muted" />
            <div className="mt-6 h-56 rounded-lg bg-muted/40" />
          </Card>
        ))}
      </div>
    );
  }

  if (!summaryData) {
    return null;
  }

  const trendData = [
    ...historicalData,
    {
      ...summaryData,
      week_start_date: summaryData.week_start_date,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompletionTrendChart summaries={trendData} />
        <TasksCompletedChart summaries={trendData} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PriorityDistributionChart
          distribution={summaryData.priority_distribution || {}}
        />
        <StatusDistributionChart
          distribution={summaryData.status_distribution || {}}
        />
      </div>
    </div>
  );
}

export const MemoizedSummaryCharts = React.memo(SummaryCharts);
