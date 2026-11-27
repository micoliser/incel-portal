import axios from "axios";

import { apiClient } from "@/lib/api-client";
import type { Paginated, UserSummary } from "@/lib/api/types";

export const CURRENCIES = ["NGN", "USD", "AED", "GBP", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type ClientStatus = "active" | "inactive";

export type CreditClient = {
  id: string;
  name: string;
  tin: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  /** Money is sent as text with 2 decimal places, e.g. "1500000.00". */
  credit_limit: string;
  credit_days: number;
  credit_utilization: string;
  /** Always credit limit minus credit utilization; may be negative. */
  available_balance: string;
  currency: Currency;
  status: ClientStatus;
  notes: string;
  created_by: UserSummary | null;
  updated_by: UserSummary | null;
  created_at: string;
  updated_at: string;
};

export type ClientFormValues = {
  name: string;
  tin: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  credit_limit: string;
  credit_days: string;
  credit_utilization: string;
  currency: Currency;
  status: ClientStatus;
  notes: string;
};

export type ClientChange = {
  id: string;
  source: "created" | "edited" | "imported" | "request";
  changed_by: UserSummary | null;
  /** {field: [old, new]} */
  changes: Record<string, [string, string]>;
  file_name: string | null;
  /** What caused it, for request-driven changes, e.g. "TKT-2026-00042 submitted". */
  note: string;
  created_at: string;
};

export type ClientImportRecord = {
  id: string;
  file_name: string;
  uploaded_by: UserSummary | null;
  rows: number;
  created_count: number;
  updated_count: number;
  rejected_count: number;
  created_at: string;
};

export type ImportRowValues = Partial<Record<keyof ClientFormValues, string | number>>;

export type ImportNotice = {
  code:
    | "unrecognised_columns"
    | "default_status"
    | "default_currency"
    | "default_credit_utilization"
    | "available_balance_ignored"
    | "over_limit";
  message: string;
  columns?: string[];
  rows?: { row: number; name: string; available_balance: string; currency: string }[];
};

export type DuplicateGroup = {
  id: string;
  reason: string;
  rows: { row: number; values: ImportRowValues }[];
  existing: { id: string; values: ImportRowValues } | null;
};

export type ImportPreview = {
  file_name: string;
  column_errors: string[];
  row_errors: { row: number; field: string; column: string; message: string }[];
  can_import: boolean;
  notices: ImportNotice[];
  duplicates: DuplicateGroup[];
  rows: { row: number; values: ImportRowValues; duplicate_group: string | null }[];
  summary: { rows: number; new: number; duplicate_groups: number };
};

/** For a duplicate group: "reject", or the row number to import (or update the existing client with). */
export type ImportDecisions = Record<string, "reject" | number>;

export const FIELD_LABELS: Record<keyof ClientFormValues, string> = {
  name: "Name",
  tin: "TIN",
  contact_person: "Contact person",
  phone: "Phone",
  email: "Email",
  address: "Address",
  credit_limit: "Credit limit",
  credit_days: "Credit days",
  credit_utilization: "Credit utilization",
  currency: "Currency",
  status: "Status",
  notes: "Notes",
};

export async function fetchClients(params: Record<string, string | number>) {
  const response = await apiClient.get<Paginated<CreditClient>>("/clients", { params });
  return response.data;
}

export async function fetchClient(id: string) {
  const response = await apiClient.get<CreditClient>(`/clients/${id}`);
  return response.data;
}

export async function createClient(values: Partial<ClientFormValues>) {
  const response = await apiClient.post<CreditClient>("/clients", values);
  return response.data;
}

export async function updateClient(id: string, values: Partial<ClientFormValues>) {
  const response = await apiClient.patch<CreditClient>(`/clients/${id}`, values);
  return response.data;
}

export async function fetchClientHistory(id: string, page = 1) {
  const response = await apiClient.get<Paginated<ClientChange>>(`/clients/${id}/history`, { params: { page } });
  return response.data;
}

export async function fetchClientImports(page = 1) {
  const response = await apiClient.get<Paginated<ClientImportRecord>>("/clients/imports", { params: { page } });
  return response.data;
}

export async function downloadImportTemplate() {
  const response = await apiClient.get<Blob>("/clients/imports/template", { responseType: "blob" });
  return response.data;
}

function fileForm(file: File, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

// The client's default JSON content type would make axios turn the FormData
// into JSON. With multipart, axios leaves the body alone and the browser sets
// the boundary.
const multipart = { headers: { "Content-Type": "multipart/form-data" } };

export async function previewImport(file: File) {
  const response = await apiClient.post<ImportPreview>("/clients/imports/preview", fileForm(file), multipart);
  return response.data;
}

export async function confirmImport(file: File, decisions: ImportDecisions) {
  const response = await apiClient.post<ClientImportRecord>(
    "/clients/imports/confirm",
    fileForm(file, { confirmed: "true", decisions: JSON.stringify(decisions) }),
    multipart,
  );
  return response.data;
}

/** Field messages from a 400 ({error: {details: {field: [message]}}}), first message per field. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};
  const details = (error.response?.data as { error?: { details?: Record<string, unknown> } } | undefined)?.error
    ?.details;
  if (!details || typeof details !== "object") return {};
  const result: Record<string, string> = {};
  for (const [field, value] of Object.entries(details)) {
    const message = Array.isArray(value) ? value.find((item) => typeof item === "string") : value;
    if (typeof message === "string") result[field] = message;
  }
  return result;
}

export function formatMoney(amount: string | number | undefined | null, currency: string = "NGN") {
  const value = typeof amount === "number" ? amount : Number(amount ?? 0);
  if (!Number.isFinite(value)) return String(amount ?? "");
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function isNegative(amount: string | number | undefined | null) {
  return Number(amount ?? 0) < 0;
}
