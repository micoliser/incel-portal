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
import { AlertCircle } from "lucide-react";

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

export function CompletionTrendChart({
  summaries,
  loading = false,
}: TrendChartProps) {
  void loading;
  if (!summaries || summaries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Completion Trend</CardTitle>
          <CardDescription>Your completion rate over time</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>Not enough data to display trend</span>
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
    <Card>
      <CardHeader>
        <CardTitle>Completion Trend</CardTitle>
        <CardDescription>
          Your completion and on-time rate over the last 4 weeks
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip
              formatter={(value) => `${(value as number).toFixed(1)}%`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="Completion Rate"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: "#3b82f6", r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              type="monotone"
              dataKey="On-Time Rate"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ fill: "#10b981", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface TasksCompletedChartProps {
  summaries: SummaryData[];
  loading?: boolean;
}

export function TasksCompletedChart({
  summaries,
  loading = false,
}: TasksCompletedChartProps) {
  void loading;
  if (!summaries || summaries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tasks Completed</CardTitle>
          <CardDescription>Weekly task completion volume</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>Not enough data to display</span>
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
    <Card>
      <CardHeader>
        <CardTitle>Tasks Completed</CardTitle>
        <CardDescription>Assigned vs completed tasks per week</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="Assigned" fill="#e5e7eb" />
            <Bar dataKey="Completed" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface PriorityDistributionProps {
  distribution: Record<string, number>;
}

const COLORS = {
  high: "#ef4444",
  medium: "#f59e0b",
  low: "#10b981",
};

export function PriorityDistributionChart({
  distribution,
}: PriorityDistributionProps) {
  if (!distribution || Object.keys(distribution).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Priority Distribution</CardTitle>
          <CardDescription>Tasks by priority level</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>No priority data available</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = Object.entries(distribution).map(([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Priority Distribution</CardTitle>
        <CardDescription>Breakdown of tasks by priority level</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name}: ${value}`}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    COLORS[entry.name.toLowerCase() as keyof typeof COLORS] ||
                    "#8884d8"
                  }
                />
              ))}
            </Pie>
            <Tooltip formatter={(value) => `${value} tasks`} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface StatusDistributionProps {
  distribution: Record<string, number>;
}

const STATUS_COLORS = {
  pending: "#6b7280",
  in_progress: "#f59e0b",
  completed: "#10b981",
};

export function StatusDistributionChart({
  distribution,
}: StatusDistributionProps) {
  if (!distribution || Object.keys(distribution).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Status Distribution</CardTitle>
          <CardDescription>Tasks by status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-gray-500">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>No status data available</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const chartData = Object.entries(distribution).map(([name, value]) => ({
    name: name.replace("_", " ").toUpperCase(),
    value,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Status Distribution</CardTitle>
        <CardDescription>Breakdown of tasks by current status</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name}: ${value}`}
              outerRadius={100}
              fill="#8884d8"
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    STATUS_COLORS[
                      entry.name
                        .toLowerCase()
                        .replace(" ", "_") as keyof typeof STATUS_COLORS
                    ] || "#8884d8"
                  }
                />
              ))}
            </Pie>
            <Tooltip formatter={(value) => `${value} tasks`} />
          </PieChart>
        </ResponsiveContainer>
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="h-4 bg-gray-200 rounded w-1/2" />
          </CardHeader>
          <CardContent>
            <div className="h-64 bg-gray-200 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!summaryData) {
    return null;
  }

  // Combine historical and current data for trend chart
  const trendData = [
    ...historicalData,
    {
      ...summaryData,
      week_start_date: summaryData.week_start_date,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CompletionTrendChart summaries={trendData} />
        <TasksCompletedChart summaries={trendData} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
