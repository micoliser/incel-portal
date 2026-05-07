import axios from "axios";

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        return item.trim();
      }
    }
  }

  return null;
}

export function extractApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (!axios.isAxiosError(error)) {
    return fallback;
  }

  const data = error.response?.data as
    | string
    | {
        detail?: unknown;
        message?: unknown;
        error?: { message?: unknown };
        non_field_errors?: unknown;
        [key: string]: unknown;
      }
    | undefined;

  if (typeof data === "string" && data.trim()) {
    return data.trim();
  }

  if (data && typeof data === "object") {
    const direct =
      firstString(data.detail) ||
      firstString(data.message) ||
      firstString(data.error?.message) ||
      firstString(data.non_field_errors);

    if (direct) {
      return direct;
    }

    for (const [field, value] of Object.entries(data)) {
      if (["detail", "message", "error", "non_field_errors"].includes(field)) {
        continue;
      }

      const fieldMessage = firstString(value);
      if (fieldMessage) {
        return `${field}: ${fieldMessage}`;
      }
    }
  }

  if (error.code === "ERR_NETWORK") {
    return "Network error. Please check your connection and try again.";
  }

  return fallback;
}
