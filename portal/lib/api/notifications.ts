import { apiClient } from "@/lib/api-client";

export type NotificationItem = {
  id: number;
  notification_type: string;
  title: string;
  body: string;
  link_url: string;
  payload_json: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  actor_username: string | null;
};

export type NotificationListResponse = {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  next_page: number | null;
  previous_page: number | null;
  results: NotificationItem[];
};

export type PushSubscriptionRecord = {
  id: number;
  endpoint: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export async function getNotifications(
  page = 1,
  pageSize = 20,
): Promise<NotificationListResponse> {
  const response = await apiClient.get("/notifications", {
    params: { page, page_size: pageSize },
  });
  return response.data;
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await apiClient.get("/notifications/unread-count");
  return Number(response.data?.unread_count || 0);
}

export async function markNotificationRead(
  id: number,
): Promise<NotificationItem> {
  const response = await apiClient.post(`/notifications/${id}/read`);
  return response.data;
}

export async function markAllNotificationsRead(): Promise<number> {
  const response = await apiClient.post("/notifications/read-all");
  return Number(response.data?.updated || 0);
}

export async function clearNotification(id: number): Promise<void> {
  await apiClient.delete(`/notifications/${id}`);
}

export async function clearAllNotifications(): Promise<number> {
  const response = await apiClient.delete("/notifications/clear-all");
  return Number(response.data?.deleted || 0);
}

export async function getPushPublicKey(): Promise<string> {
  const response = await apiClient.get("/notifications/push-public-key");
  return response.data?.public_key || "";
}

export async function listPushSubscriptions(): Promise<
  PushSubscriptionRecord[]
> {
  const response = await apiClient.get("/notifications/subscriptions");
  return response.data;
}

export async function upsertPushSubscription(payload: {
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent?: string;
}): Promise<PushSubscriptionRecord> {
  const response = await apiClient.post("/notifications/subscriptions", {
    subscription: {
      endpoint: payload.endpoint,
      keys: {
        p256dh: payload.p256dh,
        auth: payload.auth,
      },
    },
    user_agent: payload.user_agent,
  });
  return response.data;
}

export async function deletePushSubscription(
  subscriptionId: number,
): Promise<void> {
  await apiClient.delete(`/notifications/subscriptions/${subscriptionId}`);
}
