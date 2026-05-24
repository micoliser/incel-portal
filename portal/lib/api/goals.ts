import { apiClient } from "@/lib/api-client";

export type GoalMetric =
  | "tasks_completed"
  | "high_priority_completed"
  | "files_attached"
  | "comments_added";

export interface GoalProgress {
  target: number;
  current: number;
  achieved: boolean;
  difference: number;
}

export interface GoalRecord {
  id: string;
  metric: GoalMetric;
  target_value: number;
  period_start: string;
  period_end: string;
  is_active: boolean;
  created_at: string;
  progress?: GoalProgress | null;
}

export interface GoalsWeekResponse {
  week_start_date: string;
  week_end_date: string;
  goals: GoalRecord[];
}

export interface CreateGoalPayload {
  metric: GoalMetric;
  target_value: number;
  week_start_date?: string;
}

export const goalsAPI = {
  async getGoalsForWeek(weekStartDate?: string): Promise<GoalsWeekResponse> {
    const { data } = await apiClient.get<GoalsWeekResponse>("/goals/", {
      params: weekStartDate ? { week_start_date: weekStartDate } : undefined,
    });
    return data;
  },

  async createGoal(payload: CreateGoalPayload): Promise<GoalRecord> {
    const { data } = await apiClient.post<GoalRecord>("/goals/", payload);
    return data;
  },
};
