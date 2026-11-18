import axios from "axios";

const SERVER_ERROR_MESSAGE =
  "Something went wrong on our side. Please try again in a moment.";

/** An HTML page (a proxy's or the server's error page) rather than a message. */
function looksLikeHtml(value: string): boolean {
  return value.trimStart().startsWith("<");
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() && !looksLikeHtml(value)) {
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

  // A proxy or the server's own error page (HTML) is not a message for people.
  if (typeof data === "string" && data.trim() && !looksLikeHtml(data)) {
    return data.trim();
  }

  if (data && typeof data === "object") {
    // Check for our custom backend validation error format first
    const customError = data.error as { type?: string; details?: Record<string, unknown> } | undefined;
    if (customError?.type === "validation_error" && customError.details && typeof customError.details === "object") {
      for (const [field, value] of Object.entries(customError.details)) {
        const fieldMessage = firstString(value);
        if (fieldMessage) {
          return field === "non_field_errors" ? fieldMessage : `${field}: ${fieldMessage}`;
        }
      }
    }

    const direct =
      firstString(data.detail) ||
      firstString(data.message) ||
      firstString(data.error) ||
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

  const status = error.response?.status ?? 0;
  if (status >= 500) {
    return SERVER_ERROR_MESSAGE;
  }

  return fallback;
}
