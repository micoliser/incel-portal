import { apiClient } from "@/lib/api-client";

export interface WeeklySummary {
  week_start_date: string;
  week_end_date: string;
  user_id: string;
  user_name: string;
  tasks_created: number;
  tasks_assigned: number;
  tasks_completed: number;
  completion_rate_percent: number;
  on_time_completion_rate_percent: number;
  high_priority_tasks: number;
  high_priority_completed: number;
  comments_added: number;
  files_attached: number;
  recurring_schedules_created: number;
  active_recurring_schedules: number;
  priority_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  summary_message: string;
}

export interface AvailableWeek {
  week_start_date: string;
  week_end_date: string;
  created_at: string;
}

export interface ShareResponse {
  share_link: string;
  share_token: string;
  created_at: string;
}

export const summariesAPI = {
  /**
   * Get list of available weeks with summaries
   */
  async getAvailableWeeks(): Promise<AvailableWeek[]> {
    const { data } = await apiClient.get<AvailableWeek[]>(
      "/summaries/available_weeks/",
    );
    return data;
  },

  /**
   * Get summary for a specific week
   */
  async getSummary(weekStartDate: string): Promise<WeeklySummary> {
    const { data } = await apiClient.get<WeeklySummary>("/summaries/summary/", {
      params: {
        week_start_date: weekStartDate,
      },
    });
    return data;
  },

  /**
   * Create a shareable link for a summary
   */
  async createShareLink(weekStartDate: string): Promise<ShareResponse> {
    const { data } = await apiClient.post<ShareResponse>("/summaries/share/", {
      week_start_date: weekStartDate,
    });
    return data;
  },

  /**
   * Get a shared summary (public endpoint, no auth needed)
   */
  async getSharedSummary(shareToken: string): Promise<WeeklySummary> {
    const { data } = await apiClient.get<WeeklySummary>("/summaries/shared/", {
      params: {
        token: shareToken,
      },
    });
    return data;
  },
};
