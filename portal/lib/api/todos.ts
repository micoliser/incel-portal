import { apiClient } from "@/lib/api-client";

export interface TodoItem {
  id: string;
  title: string;
  description: string;
  due_date: string | null;
  due_time: string | null;
  due_datetime: string | null;
  priority: "low" | "medium" | "high";
  is_completed: boolean;
  completed_at: string | null;
  reminder_at: string | null;
  reminder_offset: string;
  reminder_offsets: string[];
  reminders_sent: string[];
  reminder_sent: boolean;
  reminder_sent_at: string | null;
  send_email_reminder: boolean;
  is_overdue: boolean;
  status_category: "overdue" | "today" | "upcoming" | "no_date" | "completed";
  created_at: string;
  updated_at: string;
}

export interface TodoStats {
  total: number;
  today: number;
  upcoming: number;
  overdue: number;
  completed: number;
}

export interface CreateTodoPayload {
  title: string;
  description?: string;
  due_date?: string | null;
  due_time?: string | null;
  due_datetime?: string | null;
  priority?: "low" | "medium" | "high";
  reminder_offset?: string;
  reminder_offsets?: string[];
  reminder_at?: string | null;
  send_email_reminder?: boolean;
}

export interface UpdateTodoPayload {
  title?: string;
  description?: string;
  due_date?: string | null;
  due_time?: string | null;
  due_datetime?: string | null;
  priority?: "low" | "medium" | "high";
  reminder_offset?: string;
  reminder_offsets?: string[];
  reminder_at?: string | null;
  send_email_reminder?: boolean;
  is_completed?: boolean;
}

export async function getTodos(params?: {
  view?: "all" | "today" | "upcoming" | "overdue" | "completed";
  priority?: "low" | "medium" | "high";
  search?: string;
}): Promise<TodoItem[]> {
  const res = await apiClient.get<TodoItem[]>("/todos/", { params });
  return res.data;
}

export async function getTodoStats(): Promise<TodoStats> {
  const res = await apiClient.get<TodoStats>("/todos/stats/");
  return res.data;
}

export async function createTodo(payload: CreateTodoPayload): Promise<TodoItem> {
  const res = await apiClient.post<TodoItem>("/todos/", payload);
  return res.data;
}

export async function updateTodo(id: string, payload: UpdateTodoPayload): Promise<TodoItem> {
  const res = await apiClient.patch<TodoItem>(`/todos/${id}/`, payload);
  return res.data;
}

export async function toggleTodoComplete(id: string): Promise<TodoItem> {
  const res = await apiClient.post<TodoItem>(`/todos/${id}/toggle-complete/`);
  return res.data;
}

export async function snoozeTodo(id: string, minutes: number = 15): Promise<TodoItem> {
  const res = await apiClient.post<TodoItem>(`/todos/${id}/snooze/`, { minutes });
  return res.data;
}

export async function deleteTodo(id: string): Promise<void> {
  await apiClient.delete(`/todos/${id}/`);
}

export async function clearCompletedTodos(): Promise<{ deleted_count: number }> {
  const res = await apiClient.post<{ deleted_count: number }>("/todos/clear-completed/");
  return res.data;
}

