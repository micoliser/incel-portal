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
  daily_reports_created: number;
  daily_reports_subreports_created: number;
  daily_reports: DailyReportSummary[];
  recurring_schedules_created: number;
  active_recurring_schedules: number;
  priority_distribution: Record<string, number>;
  status_distribution: Record<string, number>;
  summary_message: string;
  /** Fields below exist on summaries calculated from November 2026. */
  /** Tasks on the person's list during the week (open at some point). */
  tasks_open_during_week?: number;
  has_own_work?: boolean;
  has_delegated_work?: boolean;
  /** Which section led the week: the person's own tasks, or work they gave out. */
  lead_section?: "own" | "delegated";
  delegated_tasks_given?: number;
  delegated_people?: number;
  delegated_tasks_open_during_week?: number;
  delegated_tasks_completed?: number;
  delegated_completion_rate_percent?: number;
  delegated_on_time_completion_rate_percent?: number;
  delegated_reviews_total?: number;
  delegated_reviews_approved?: number;
  delegated_reviews_sent_back?: number;
  /** Null when there were no reviews that week. */
  delegated_avg_review_hours?: number | null;
  delegated_waiting_for_review?: number;
  delegated_overdue?: number;
}

export interface DailyReportSummary {
  report_date: string;
  title: string;
  subreport_count: number;
  view_url: string;
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
  delta_delegated_tasks_given?: number;
  delta_delegated_tasks_completed?: number;
  delta_delegated_completion_rate?: number;
  delta_delegated_on_time_completion_rate?: number;
  delta_delegated_reviews?: number;
  delta_delegated_avg_review_hours?: number;
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
  created_at: string;
  expires_at: string | null;
}

export interface UserShare {
  shared_with: number | string;
  shared_with_username?: string;
  /** Present only in the response that creates the share. */
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
  view_type: "sent" | "received";
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
  total_comments_added?: number;
  total_files_attached?: number;
  total_files_received?: number;
  total_recurring_schedules_created?: number;
  total_active_recurring_schedules?: number;
  total_daily_reports_created?: number;
  total_daily_reports_subreports_created?: number;
  priority_distribution?: Record<string, number>;
  status_distribution?: Record<string, number>;
  comparison?: OrgComparisonMetrics | null;
}

export interface OrgComparisonMetrics {
  delta_users: number;
  delta_tasks_completed: number;
  delta_tasks_assigned: number;
  delta_completion_rate: number;
  delta_on_time_completion_rate: number;
  delta_comments: number;
  delta_files: number;
  trend: "up" | "down" | "flat";
  previous_week_start?: string;
  previous_active_users?: number;
  previous_tasks_completed?: number;
  previous_completion_rate?: number;
}

/** Whether a public link exists. The link itself is only returned when it is created. */
export interface ShareStatus {
  shared: boolean;
  created_at?: string;
  expires_at?: string | null;
}

const week = (weekStartDate: string) => `/summaries/weeks/${weekStartDate}`;

export const summariesAPI = {
  /** Weeks the signed-in user has a summary for, newest first. */
  async getAvailableWeeks(): Promise<AvailableWeek[]> {
    const { data } = await apiClient.get<AvailableWeek[]>("/summaries/weeks");
    return data;
  },

  /** The summary for the week starting on the given Monday. */
  async getSummary(weekStartDate: string): Promise<WeeklySummary> {
    const { data } = await apiClient.get<WeeklySummary>(week(weekStartDate));
    return data;
  },

  /**
   * Create the public share link. A summary has one link at a time: creating
   * a new one replaces the previous one. The link is returned only here.
   */
  async createShareLink(weekStartDate: string): Promise<ShareResponse> {
    const { data } = await apiClient.post<ShareResponse>(`${week(weekStartDate)}/share`);
    return data;
  },

  async getShareStatus(weekStartDate: string): Promise<ShareStatus> {
    const { data } = await apiClient.get<ShareStatus>(`${week(weekStartDate)}/share`);
    return data;
  },

  async revokeShare(weekStartDate: string): Promise<void> {
    await apiClient.delete(`${week(weekStartDate)}/share`);
  },

  /** Share with one colleague, who is emailed and notified with their own link. */
  async shareWithUser(weekStartDate: string, userId: number) {
    const { data } = await apiClient.post<UserShare>(`${week(weekStartDate)}/user-shares`, {
      user_id: userId,
    });
    return data;
  },

  async getUserShares(weekStartDate: string) {
    const { data } = await apiClient.get<UserShare[]>(`${week(weekStartDate)}/user-shares`);
    return data;
  },

  async revokeUserShare(weekStartDate: string, userId: number): Promise<void> {
    await apiClient.delete(`${week(weekStartDate)}/user-shares/${userId}`);
  },

  /** Open a summary from a share link. */
  async getSharedSummary(
    shareToken: string,
  ): Promise<{ summary: SharedWeeklySummary; historical?: WeeklySummary[] }> {
    const { data } = await apiClient.get<{
      summary: SharedWeeklySummary;
      historical?: WeeklySummary[];
    }>(`/summaries/shared/${encodeURIComponent(shareToken)}`);
    return data;
  },

  /** Change against the week before. */
  async getComparisonMetrics(weekStartDate: string): Promise<ComparisonMetrics> {
    const { data } = await apiClient.get<ComparisonMetrics>(`${week(weekStartDate)}/comparison`);
    return data;
  },

  /** The given week and the ones before it, oldest first. */
  async getHistoricalSummaries(weekStartDate: string, weeks = 4): Promise<WeeklySummary[]> {
    const { data } = await apiClient.get<WeeklySummary[]>(`${week(weekStartDate)}/history`, {
      params: { weeks },
    });
    return data;
  },

  /**
   * Files for a summary, grouped by task.
   * @param viewType - 'sent' for files attached by the user, 'received' for files from others
   */
  async getWeekFiles(
    summaryId: string,
    viewType: "sent" | "received" = "sent",
    token?: string,
  ): Promise<SummaryFilesResponse> {
    const params: { view: "sent" | "received"; token?: string } = {
      view: viewType,
    };
    if (token) params.token = token;

    const { data } = await apiClient.get<SummaryFilesResponse>(`/summaries/${summaryId}/files`, {
      params,
    });
    return data;
  },

  /** Generate and store a PDF of the summary. Returns the export record with its file URL. */
  async exportSummary(weekStartDate: string): Promise<SummaryExport> {
    const { data } = await apiClient.post<SummaryExport>(`${week(weekStartDate)}/export`);
    return data;
  },

  /** Organization-wide figures for a week (executives only). */
  async getOrganizationSummary(weekStartDate: string): Promise<OrganizationSummary> {
    const { data } = await apiClient.get<OrganizationSummary>("/summaries/organization", {
      params: { week_start_date: weekStartDate },
    });
    return data;
  },
};
