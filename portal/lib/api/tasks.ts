import { apiClient } from "@/lib/api-client";

export interface Task {
  id: string;
  title: string;
  description: string;
  assigned_by: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  assigned_to: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  status: "pending" | "in_progress" | "completed";
  priority: "low" | "medium" | "high";
  deadline: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface TaskActivity {
  id: string;
  task: string;
  user: {
    id: number;
    username: string;
    full_name: string;
    email: string;
  };
  activity_type: "status_change" | "assignment" | "comment" | "created";
  old_value: string | null;
  new_value: string | null;
  comment: string | null;
  attachments: TaskAttachment[];
  created_at: string;
}

export interface TaskAttachment {
  id: string;
  file_name: string;
  content_type: string;
  size: number;
  download_url: string | null;
  created_at: string;
}

export interface UserOption {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  department_id: string | null;
  is_active: boolean;
}

export interface GetUsersParams {
  search?: string;
  department_id?: string;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  assigned_to_id: number;
  priority: "low" | "medium" | "high";
  deadline?: string;
}

export interface GetTasksParams {
  view?: "assigned" | "created";
  status?: Task["status"][];
  priority?: Task["priority"][];
  page?: number;
}

export interface TaskAttachmentUploadRequest {
  file_name: string;
  content_type: string;
  size: number;
}

export interface TaskAttachmentUploadResponse {
  upload_url: string;
  object_key: string;
  expires_in: number;
}

export interface TaskCommentAttachmentPayload {
  object_key: string;
  file_name: string;
  content_type: string;
  size: number;
}

export interface TaskListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: Task[];
}

export async function getTasks(
  params?: GetTasksParams,
): Promise<TaskListResponse> {
  const response = await apiClient.get("/tasks/", {
    params: {
      view: params?.view,
      status: params?.status?.length ? params.status.join(",") : undefined,
      priority: params?.priority?.length
        ? params.priority.join(",")
        : undefined,
      page: params?.page,
    },
  });

  if (Array.isArray(response.data)) {
    return {
      count: response.data.length,
      next: null,
      previous: null,
      results: response.data,
    };
  }

  return response.data;
}

export async function getTaskDetail(id: string): Promise<Task> {
  const response = await apiClient.get(`/tasks/${id}/`);
  return response.data;
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  const response = await apiClient.post("/tasks/", payload);
  return response.data;
}

export async function updateTaskStatus(
  id: string,
  status: string,
): Promise<Task> {
  const response = await apiClient.patch(`/tasks/${id}/`, { status });
  return response.data;
}

export async function getTaskActivities(
  taskId: string,
): Promise<TaskActivity[]> {
  const response = await apiClient.get(`/tasks/${taskId}/activities/`);
  return response.data;
}

export async function getTaskAttachmentUploadUrl(
  taskId: string,
  payload: TaskAttachmentUploadRequest,
): Promise<TaskAttachmentUploadResponse> {
  const response = await apiClient.post(
    `/tasks/${taskId}/attachment-upload-url/`,
    payload,
  );
  return response.data;
}

export async function addTaskComment(
  taskId: string,
  comment: string,
  attachments?: TaskCommentAttachmentPayload[],
): Promise<TaskActivity> {
  const response = await apiClient.post(`/tasks/${taskId}/comments/`, {
    comment,
    ...(attachments ? { attachments } : {}),
  });
  return response.data;
}

export async function getUsers(params?: GetUsersParams): Promise<UserOption[]> {
  const response = await apiClient.get("/users", {
    params,
  });
  return response.data.results || response.data;
}
