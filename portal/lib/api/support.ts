import { apiClient } from "@/lib/api-client";

export interface SupportRequest {
  id: string;
  title: string;
  category: "IT_SUPPORT" | "OTHER";
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "assigned" | "in_progress" | "resolved" | "closed";
  description: string;
  requester: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  department: {
    id: string;
    name: string;
    code: string;
  };
  assigned_to: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  } | null;
  assigned_by: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  } | null;
  can_manage?: boolean;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupportRequestDetail extends SupportRequest {
  comments: SupportComment[];
  attachments: SupportAttachment[];
  attachment_count: number;
  can_manage: boolean;
  can_act: boolean;
}

export interface SupportComment {
  id: string;
  author: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  body: string;
  is_system: boolean;
  attachments: SupportAttachment[];
  created_at: string;
}

export interface SupportAttachment {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  download_url: string | null;
  created_at: string;
}

export interface UploadUrlResult {
  upload_url: string;
  object_key: string;
  expires_in: number;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── List my requests ──

export async function getMyRequests(params?: {
  status?: string;
  page?: number;
}): Promise<PaginatedResponse<SupportRequest>> {
  const response = await apiClient.get("/support/requests/", { params });
  return response.data;
}

// ── Department requests (manager view) ──

export async function getDepartmentRequests(params?: {
  status?: string;
  page?: number;
}): Promise<PaginatedResponse<SupportRequest>> {
  const response = await apiClient.get("/support/requests/department/", {
    params,
  });
  return response.data;
}

// ── Get single request with detail ──

export async function getRequest(id: string): Promise<SupportRequestDetail> {
  const response = await apiClient.get(`/support/requests/${id}/`);
  return response.data;
}

// ── Create a new request ──

export interface CreateRequestPayload {
  title: string;
  category: "IT_SUPPORT" | "OTHER";
  priority: "low" | "medium" | "high" | "urgent";
  description: string;
}

export async function createRequest(
  data: CreateRequestPayload,
): Promise<SupportRequestDetail> {
  const response = await apiClient.post("/support/requests/", data);
  return response.data;
}

// ── Assign a handler ──

export async function assignRequest(
  id: string,
  assignedTo: number,
): Promise<SupportRequestDetail> {
  const response = await apiClient.post(`/support/requests/${id}/assign/`, {
    assigned_to: assignedTo,
  });
  return response.data;
}

// ── Update status ──

export async function updateRequestStatus(
  id: string,
  status: string,
): Promise<SupportRequestDetail> {
  const response = await apiClient.post(
    `/support/requests/${id}/update-status/`,
    { status },
  );
  return response.data;
}

// ── Resolve (handler) ──

export async function resolveRequest(
  id: string,
): Promise<SupportRequestDetail> {
  const response = await apiClient.post(`/support/requests/${id}/resolve/`);
  return response.data;
}

// ── Confirm (requester) ──

export async function confirmRequest(
  id: string,
): Promise<SupportRequestDetail> {
  const response = await apiClient.post(`/support/requests/${id}/confirm/`);
  return response.data;
}

// ── Reopen (requester) ──

export async function reopenRequest(id: string): Promise<SupportRequestDetail> {
  const response = await apiClient.post(`/support/requests/${id}/reopen/`);
  return response.data;
}

// ── Add comment ──

export async function addComment(
  id: string,
  body: string,
): Promise<SupportComment> {
  const response = await apiClient.post(
    `/support/requests/${id}/add-comment/`,
    { body },
  );
  return response.data;
}

// ── Upload URL (presigned S3) ──

export async function getUploadUrl(
  id: string,
  file: { file_name: string; content_type: string; size: number },
): Promise<UploadUrlResult> {
  const response = await apiClient.post(
    `/support/requests/${id}/upload-url/`,
    file,
  );
  return response.data;
}

// ── Confirm upload ──

export interface ConfirmUploadPayload {
  object_key: string;
  file_name: string;
  content_type: string;
  size: number;
  comment_id?: string;
}

export async function confirmUpload(
  id: string,
  data: ConfirmUploadPayload,
): Promise<SupportAttachment> {
  const response = await apiClient.post(
    `/support/requests/${id}/confirm-upload/`,
    data,
  );
  return response.data;
}
