import { apiClient } from "@/lib/api-client";

export type MaintenanceLogAttachment = {
  id: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size: number;
  file_url?: string;
  created_at: string;
};

export type MaintenanceLog = {
  id: string;
  item: {
    id: string;
    code: string;
    name: string;
    serial_number: string;
    status: string;
    category?: { id: string; name: string };
  };
  date: string;
  issue_reported: string;
  action_taken: string;
  assigned_to: { id: string | number; first_name?: string; last_name?: string; email?: string } | null;
  status: string;
  attachments: MaintenanceLogAttachment[];
  created_by: { id: string | number; first_name?: string; last_name?: string; email?: string } | null;
  created_at: string;
};

export async function fetchMaintenanceLogs(params?: Record<string, string | number | boolean>) {
  const response = await apiClient.get("/inventory/maintenance-logs/", { params });
  return response.data;
}

export async function createMaintenanceLog(data: Record<string, unknown>) {
  const response = await apiClient.post("/inventory/maintenance-logs/", data);
  return response.data;
}

export async function updateMaintenanceLog(id: string, data: Record<string, unknown>) {
  const response = await apiClient.patch(`/inventory/maintenance-logs/${id}/`, data);
  return response.data;
}

export async function getAttachmentUploadUrl(payload: { file_name: string; content_type: string }) {
  const response = await apiClient.post("/inventory/maintenance-logs/upload-url/", payload);
  return response.data as {
    upload_url: string;
    public_url: string;
    object_key: string;
  };
}

export async function getInventoryPhotoUploadUrl(payload: { file_name: string; content_type: string }) {
  const response = await apiClient.post("/inventory/items/upload_photo_url/", payload);
  return response.data as {
    upload_url: string;
    public_url: string;
    object_key: string;
  };
}

export async function exportInventoryItems(params?: Record<string, string | number | boolean>) {
  const response = await apiClient.get("/inventory/items/export/", {
    params,
    responseType: "blob",
  });
  return response.data;
}

export async function exportMaintenanceLogs(params?: Record<string, string | number | boolean>) {
  const response = await apiClient.get("/inventory/maintenance-logs/export/", {
    params,
    responseType: "blob",
  });
  return response.data;
}
