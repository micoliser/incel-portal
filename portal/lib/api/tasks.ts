import { apiClient } from "@/lib/api-client";

export interface Task {
  id: number;
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
  id: number;
  task: number;
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
  created_at: string;
}

export interface UserOption {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  department_id: number | null;
  is_active: boolean;
}

export interface GetUsersParams {
  search?: string;
  department_id?: number;
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

export async function getTaskDetail(id: number): Promise<Task> {
  const response = await apiClient.get(`/tasks/${id}/`);
  return response.data;
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  const response = await apiClient.post("/tasks/", payload);
  return response.data;
}

export async function updateTaskStatus(
  id: number,
  status: string,
): Promise<Task> {
  const response = await apiClient.patch(`/tasks/${id}/`, { status });
  return response.data;
}

export async function getTaskActivities(
  taskId: number,
): Promise<TaskActivity[]> {
  const response = await apiClient.get(`/tasks/${taskId}/activities/`);
  return response.data;
}

export async function getUsers(params?: GetUsersParams): Promise<UserOption[]> {
  const response = await apiClient.get("/users", {
    params,
  });
  return response.data.results || response.data;
}
