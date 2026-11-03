import { apiClient } from "@/lib/api-client";

export interface PasswordResetValidateResponse {
  valid: boolean;
  email?: string;
  detail?: string;
}

export interface PasswordResetConfirmPayload {
  uid: string;
  token: string;
  new_password: string;
}

export async function requestPasswordReset(
  email: string,
): Promise<{ detail: string }> {
  const response = await apiClient.post<{ detail: string }>(
    "/auth/password-reset",
    { email },
  );
  return response.data;
}

export async function validatePasswordResetToken(
  uid: string,
  token: string,
): Promise<PasswordResetValidateResponse> {
  const response = await apiClient.get<PasswordResetValidateResponse>(
    "/auth/password-reset/validate",
    {
      params: { uid, token },
    },
  );
  return response.data;
}

export async function confirmPasswordReset(
  payload: PasswordResetConfirmPayload,
): Promise<{ detail: string }> {
  const response = await apiClient.post<{ detail: string }>(
    "/auth/password-reset/confirm",
    payload,
  );
  return response.data;
}

