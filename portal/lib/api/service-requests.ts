import { apiClient } from "@/lib/api-client";
import type { Paginated, UserSummary } from "@/lib/api/types";

export type RequestStatus = "submitted" | "pending_approval" | "approved" | "rejected" | "completed" | "cancelled";
export type PaymentType = "cash" | "credit";
export type PartyType = "client" | "affiliate";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "Submitted",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const FOREIGN_CURRENCIES = ["USD", "AED", "GBP", "EUR"] as const;

/** Payment evidence: images and PDFs, at most 5 MB. */
export const EVIDENCE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
];
export const EVIDENCE_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf," + EVIDENCE_TYPES.join(",");
export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

export type Evidence = { object_key: string; file_name: string; content_type: string; size: number };

export type ServiceRequestSummary = {
  id: string;
  service: "ticket";
  reference: string;
  title: string;
  status: RequestStatus;
  approval_stage: "" | "first" | "final";
  payment_type: PaymentType;
  party_type: PartyType;
  client_name: string;
  selling_price: string;
  passengers: string[];
  pnr: string;
  submitted_by: UserSummary;
  created_at: string;
  updated_at: string;
};

export type TicketDetails = {
  passengers: string[];
  airline: string;
  pnr: string;
  departure_date: string;
  return_date: string | null;
  route: string;
  vendor: string;
  published_fare: string | null;
  net_commission: string | null;
  commission_given: string | null;
  balance_commission: string | null;
};

export type ServiceRequestDetail = ServiceRequestSummary & {
  ticket: TicketDetails;
  client_id: string | null;
  cost_price: string;
  revenue: string;
  foreign_currency: string;
  foreign_amount: string | null;
  exchange_rate: string | null;
  amount_paid: string | null;
  evidence: Evidence | null;
  credit: {
    currency: string;
    credit_limit: string;
    utilization: string;
    available_balance: string;
    requested_amount: string;
    balance_after_request: string;
  } | null;
  decisions: {
    id: string;
    stage: "first" | "final";
    decision: "approved" | "rejected";
    decided_by: UserSummary;
    reason: string;
    created_at: string;
  }[];
  closed_reason: string;
  completed_at: string | null;
  created_from: string | null;
  allowed: { approve: boolean; reject: boolean; complete: boolean; cancel: boolean; copy: boolean };
};

export type RequestEvent = {
  id: string;
  action: "submitted" | "sent_for_approval" | "first_approved" | "approved" | "rejected" | "completed" | "cancelled";
  actor: UserSummary | null;
  note: string;
  created_at: string;
};

/** What the ticket form sends. Amounts are text, as typed (commas removed). */
export type TicketPayload = {
  payment_type: PaymentType;
  party_type: PartyType;
  client_id?: string | null;
  client_name?: string;
  passengers: string[];
  airline: string;
  pnr: string;
  departure_date: string;
  return_date?: string | null;
  route: string;
  vendor: string;
  published_fare?: string | null;
  net_commission?: string | null;
  commission_given?: string | null;
  selling_price: string;
  cost_price?: string | null;
  confirm_zero_revenue?: boolean;
  foreign_currency?: string;
  foreign_amount?: string | null;
  exchange_rate?: string | null;
  amount_paid?: string | null;
  evidence?: Evidence | null;
  created_from?: string | null;
};

export async function fetchRequests(params: Record<string, string | number | boolean>) {
  const response = await apiClient.get<Paginated<ServiceRequestSummary>>("/service-requests", { params });
  return response.data;
}

export async function fetchRequest(id: string) {
  const response = await apiClient.get<ServiceRequestDetail>(`/service-requests/${id}`);
  return response.data;
}

export async function fetchRequestHistory(id: string, page = 1) {
  const response = await apiClient.get<Paginated<RequestEvent>>(`/service-requests/${id}/history`, { params: { page } });
  return response.data;
}

export async function fetchAwaitingCount() {
  const response = await apiClient.get<{ count: number }>("/service-requests/awaiting-count");
  return response.data.count;
}

export async function submitTicket(payload: TicketPayload) {
  const response = await apiClient.post<ServiceRequestDetail>("/service-requests/tickets", payload);
  return response.data;
}

export async function approveRequest(id: string) {
  const response = await apiClient.post<ServiceRequestDetail>(`/service-requests/${id}/approve`, {});
  return response.data;
}

export async function rejectRequest(id: string, reason: string) {
  const response = await apiClient.post<ServiceRequestDetail>(`/service-requests/${id}/reject`, { reason });
  return response.data;
}

export async function completeRequest(id: string) {
  const response = await apiClient.post<ServiceRequestDetail>(`/service-requests/${id}/complete`, {});
  return response.data;
}

export async function cancelRequest(id: string, reason: string) {
  const response = await apiClient.post<ServiceRequestDetail>(`/service-requests/${id}/cancel`, { reason });
  return response.data;
}

export async function evidenceLink(id: string) {
  const response = await apiClient.get<{ url: string }>(`/service-requests/${id}/evidence`);
  return response.data.url;
}

export async function fetchSuggestions(field: "airline" | "vendor", search: string, page = 1) {
  const response = await apiClient.get<Paginated<string>>("/service-requests/suggestions", {
    params: { field, search, page },
  });
  return response.data;
}

/** Uploads the file straight to private storage and returns what the request records. */
export async function uploadEvidence(file: File): Promise<Evidence> {
  const contentType = file.type || "application/octet-stream";
  const { data } = await apiClient.post<{ upload_url: string; object_key: string; content_type: string }>(
    "/service-requests/evidence-upload-url",
    { file_name: file.name, content_type: contentType, size: file.size },
  );
  const uploaded = await fetch(data.upload_url, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": data.content_type },
  });
  if (!uploaded.ok) throw new Error(`The upload failed (status ${uploaded.status}). Try again.`);
  return { object_key: data.object_key, file_name: file.name, content_type: data.content_type, size: file.size };
}

/** Amounts as the API wants them: commas removed, empty as null. */
export function amountOrNull(value: string): string | null {
  const text = value.replace(/,/g, "").trim();
  return text ? text : null;
}

export function parseAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
