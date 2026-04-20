import axios from "axios";

import {
  clearStoredTokens,
  getApiBaseUrl,
  getStoredAccessToken,
  getStoredRefreshToken,
  setStoredTokens,
} from "@/lib/auth";

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

const refreshClient = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

let refreshTokenPromise: Promise<string | null> | null = null;

function shouldSkipAuthRefresh(url?: string) {
  return Boolean(
    url && (url.includes("/auth/login") || url.includes("/auth/refresh")),
  );
}

async function refreshAccessToken() {
  const refreshToken = getStoredRefreshToken();

  if (!refreshToken) {
    clearStoredTokens();
    return null;
  }

  const response = await refreshClient.post("/auth/refresh", {
    refresh: refreshToken,
  });

  const accessToken = response.data?.access as string | undefined;
  if (!accessToken) {
    clearStoredTokens();
    return null;
  }

  setStoredTokens(accessToken, refreshToken);
  return accessToken;
}

apiClient.interceptors.request.use((config) => {
  const accessToken = getStoredAccessToken();

  if (accessToken) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (
      !axios.isAxiosError(error) ||
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      shouldSkipAuthRefresh(originalRequest.url)
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      refreshTokenPromise ??= refreshAccessToken();
      const refreshedAccessToken = await refreshTokenPromise;
      if (!refreshedAccessToken) {
        clearStoredTokens();
        if (typeof window !== "undefined") {
          window.location.replace("/");
        }
        return Promise.reject(error);
      }

      originalRequest.headers = originalRequest.headers ?? {};
      originalRequest.headers.Authorization = `Bearer ${refreshedAccessToken}`;
      return apiClient.request(originalRequest);
    } catch (refreshError) {
      clearStoredTokens();
      if (typeof window !== "undefined") {
        window.location.replace("/");
      }
      return Promise.reject(refreshError);
    } finally {
      refreshTokenPromise = null;
    }
  },
);
