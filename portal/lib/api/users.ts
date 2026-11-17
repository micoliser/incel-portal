import { apiClient } from "@/lib/api-client";

export interface UserListParams {
  search?: string;
  department_id?: string;
  unit_id?: string;
  team_id?: string;
  unassigned?: "department" | "unit" | "team";
  /** Honoured only for administrators and executives. */
  include_inactive?: boolean;
  page?: number;
  page_size?: number;
}

export interface UserWritePayload {
  first_name?: string;
  last_name?: string;
  email?: string;
  department_id?: string | null;
  unit_id?: string | null;
  team_id?: string | null;
  role_id?: string | null;
}

/** The staff directory. Active users only unless `include_inactive` is allowed and set. */
export async function listUsers(params: UserListParams = {}) {
  const response = await apiClient.get("/users", { params });
  return response.data;
}

/** Creates the account and emails the new user a link to set their password. */
export async function createUser(payload: UserWritePayload) {
  const response = await apiClient.post("/users", payload);
  return response.data;
}

/** Partial update: only the fields sent are changed. */
export async function updateUser(id: string | number, payload: UserWritePayload) {
  const response = await apiClient.patch(`/users/${id}`, payload);
  return response.data;
}

export async function setUserActive(id: string | number, isActive: boolean) {
  const response = await apiClient.patch(`/users/${id}`, { is_active: isActive });
  return response.data;
}

/** Emails the user a link with which they choose a new password. */
export async function sendPasswordResetLink(id: string | number) {
  const response = await apiClient.patch(`/users/${id}`, { send_reset_link: true });
  return response.data;
}
