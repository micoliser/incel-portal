import { apiClient } from "@/lib/api-client";

export type ReportCalendarDay = {
  report_date: string;
  report_count: number;
  subreport_count: number;
  has_your_report: boolean;
};

export type ReportsMonthResponse = {
  month: string;
  dates: ReportCalendarDay[];
};

export type ReportUserSummary = {
  id: number;
  username: string;
  full_name: string;
  email: string;
};

export type DailyReportComment = {
  id: string;
  author: ReportUserSummary;
  body: string;
  created_at: string;
};

export type DailyReportSubreportSummary = {
  id: string;
  title: string;
  created_by: ReportUserSummary;
  daily_report_id: string;
  report_date: string;
  created_at: string;
  comments_count: number;
  latest_comment_at: string | null;
  view_url: string;
};

export type DailyReportSubreportDetail = DailyReportSubreportSummary & {
  comments: DailyReportComment[];
};

export type DailyReportSummary = {
  id: string;
  report_date: string;
  creator: ReportUserSummary;
  department: string;
  title: string;
  subreport_count: number;
  view_url: string;
  created_at: string;
};

export type DailyReportDetail = DailyReportSummary & {
  subreports: DailyReportSubreportSummary[];
};

export type ReportsDayResponse = {
  report_date: string;
  your_report: DailyReportDetail | null;
  all_reports: DailyReportSummary[];
};

export type CreateReportResponse = DailyReportSubreportDetail;

export const reportsAPI = {
  async getMonth(month: string): Promise<ReportsMonthResponse> {
    const { data } = await apiClient.get<ReportsMonthResponse>(
      "/reports/month/",
      {
        params: { month },
      },
    );
    return data;
  },

  async getDay(reportDate: string): Promise<ReportsDayResponse> {
    const { data } = await apiClient.get<ReportsDayResponse>("/reports/day/", {
      params: { report_date: reportDate },
    });
    return data;
  },

  async createForDay(
    reportDate: string,
    title: string,
    comment: string,
  ): Promise<CreateReportResponse> {
    const { data } = await apiClient.post<CreateReportResponse>(
      "/reports/day/",
      {
        report_date: reportDate,
        title,
        comment,
      },
    );
    return data;
  },

  async getDailyReport(reportId: string): Promise<DailyReportDetail> {
    const { data } = await apiClient.get<DailyReportDetail>(
      `/reports/daily/${reportId}/`,
    );
    return data;
  },

  async createSubreport(
    reportId: string,
    title: string,
    comment: string,
  ): Promise<CreateReportResponse> {
    const { data } = await apiClient.post<CreateReportResponse>(
      `/reports/daily/${reportId}/subreports/`,
      {
        title,
        comment,
      },
    );
    return data;
  },

  async getSubreport(subreportId: string): Promise<DailyReportSubreportDetail> {
    const { data } = await apiClient.get<DailyReportSubreportDetail>(
      `/reports/subreports/${subreportId}/`,
    );
    return data;
  },

  async addComment(
    subreportId: string,
    body: string,
  ): Promise<DailyReportComment> {
    const { data } = await apiClient.post<DailyReportComment>(
      `/reports/subreports/${subreportId}/comments/`,
      { body },
    );
    return data;
  },
};
