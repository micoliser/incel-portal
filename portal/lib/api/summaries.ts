import { apiClient } from "@/lib/api-client";

export interface WeeklySummary {
  id: string;
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
  files_received: number;
  recurring_schedules_created: number;
  active_recurring_schedules: number;
  priority_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  summary_message: string;
}

export interface ComparisonMetrics {
  delta_tasks_completed: number;
  delta_completion_rate: number;
  delta_on_time_completion_rate: number;
  delta_high_priority_completed: number;
  delta_comments: number;
  delta_files: number;
  trend: "up" | "down" | "flat";
  velocity_change_percent?: number;
  previous_week_start?: string;
}

export interface SharedWeeklySummary extends WeeklySummary {
  comparison_metrics?: ComparisonMetrics;
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

export interface UserShare {
  shared_with: number | string;
  share_token?: string;
  share_link?: string;
  created_at?: string;
}

export interface SummaryFileItem {
  file_id: string;
  file_name: string;
  size: number;
  content_type: string;
  created_at: string;
  created_by: string;
  download_url: string;
}

export interface SummaryFilesTask {
  task_id: string;
  task_title: string;
  task_created_at: string | null;
  files: SummaryFileItem[];
}

export interface SummaryFilesResponse {
  week_start: string;
  week_end: string;
  view_type: "sent" | "recieved";
  tasks: SummaryFilesTask[];
}

export interface SummaryExport {
  id: string;
  file_url: string;
  format: string;
  created_at: string;
}

export interface OrganizationSummary {
  week_start_date: string;
  week_end_date: string;
  total_active_users: number;
  total_tasks_completed: number;
  total_tasks_assigned: number;
  avg_completion_rate_percent: number;
  avg_on_time_completion_rate_percent: number;
  summaries_count: number;
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
      params: { week_start_date: weekStartDate },
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
   * Get public share status for a week
   */
  async getShareStatus(
    weekStartDate: string,
  ): Promise<{ shared: boolean; share_link?: string; share_token?: string }> {
    const { data } = await apiClient.get("/summaries/share-status/", {
      params: { week_start_date: weekStartDate },
    });
    return data;
  },

  /**
   * Revoke a public share for a week
   */
  async revokeShare(weekStartDate: string) {
    const { data } = await apiClient.post("/summaries/revoke-share/", {
      week_start_date: weekStartDate,
    });
    return data;
  },

  /**
   * Share a summary with a specific user (user-to-user share)
   */
  async shareWithUser(weekStartDate: string, userId: number) {
    const { data } = await apiClient.post<ShareResponse>(
      "/summaries/share-with-user/",
      {
        week_start_date: weekStartDate,
        user_id: userId,
      },
    );
    return data;
  },

  /**
   * List user-to-user shares for a summary
   */
  async getUserShares(weekStartDate: string) {
    const { data } = await apiClient.get<UserShare[]>(
      "/summaries/user-shares/",
      {
        params: { week_start_date: weekStartDate },
      },
    );
    return data;
  },

  /**
   * Revoke a user-to-user share
   */
  async revokeUserShare(weekStartDate: string, userId: number) {
    const { data } = await apiClient.post("/summaries/revoke-user-share/", {
      week_start_date: weekStartDate,
      user_id: userId,
    });
    return data;
  },

  /**
   * Get a shared summary (public endpoint, no auth needed)
   */
  async getSharedSummary(
    shareToken: string,
  ): Promise<{ summary: SharedWeeklySummary; historical?: WeeklySummary[] }> {
    const { data } = await apiClient.get<{
      summary: SharedWeeklySummary;
      historical?: WeeklySummary[];
    }>("/summaries/shared/", {
      params: {
        token: shareToken,
      },
    });
    return data;
  },

  /**
   * Get week-over-week comparison metrics for a summary
   */
  async getComparisonMetrics(
    weekStartDate: string,
  ): Promise<ComparisonMetrics> {
    const { data } = await apiClient.get<ComparisonMetrics>(
      "/summaries/comparison-metrics/",
      {
        params: {
          week_start_date: weekStartDate,
        },
      },
    );
    return data;
  },

  /**
   * Get historical summaries (including the provided week) for the last N weeks
   */
  async getHistoricalSummaries(
    weekStartDate: string,
    weeks = 4,
  ): Promise<WeeklySummary[]> {
    const { data } = await apiClient.get<WeeklySummary[]>(
      "/summaries/historical/",
      {
        params: {
          week_start_date: weekStartDate,
          weeks,
        },
      },
    );
    return data;
  },

  /**
   * Get files for a specific summary, grouped by task
   * @param summaryId - UUID of the weekly summary
   * @param viewType - 'sent' for files attached by user, 'recieved' for files from others
   */
  async getWeekFiles(
    summaryId: string,
    viewType: "sent" | "recieved" = "sent",
    token?: string,
  ): Promise<SummaryFilesResponse> {
    const params: { view: "sent" | "recieved"; token?: string } = {
      view: viewType,
    };
    if (token) params.token = token;

    const { data } = await apiClient.get<SummaryFilesResponse>(
      `/summaries/${summaryId}/files/`,
      {
        params,
      },
    );
    return data;
  },

  /**
   * Request server to generate and store an export (PDF). Returns export record with file_url.
   */
  async exportSummary(
    weekStartDate: string,
    format: string = "pdf",
  ): Promise<SummaryExport> {
    const { data } = await apiClient.post<SummaryExport>("/summaries/export/", {
      week_start_date: weekStartDate,
      format,
    });
    return data;
  },

  /**
   * Get organization-wide summary (admin only)
   */
  async getOrganizationSummary(
    weekStartDate: string,
  ): Promise<OrganizationSummary> {
    const { data } = await apiClient.get<OrganizationSummary>(
      "/summaries/organization-summary/",
      { params: { week_start_date: weekStartDate } },
    );
    return data;
  },
};
