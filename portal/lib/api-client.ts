import axios from "axios";

import {
  clearStoredTokens,
  getApiBaseUrl,
} from "@/lib/auth";

export const apiClient = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
});

const refreshClient = axios.create({
  baseURL: getApiBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
});

let refreshTokenPromise: Promise<string | null> | null = null;

function shouldSkipAuthRefresh(url?: string) {
  return Boolean(
    url && (url.includes("/auth/login") || url.includes("/auth/refresh")),
  );
}

async function refreshAccessToken() {
  const response = await refreshClient.post("/auth/refresh", {});

  const accessToken = response.data?.access as string | undefined;
  if (!accessToken) {
    clearStoredTokens();
    return null;
  }

  return accessToken;
}

// The token is now sent automatically via HttpOnly cookies, so we don't
// need to manually inject it here.
apiClient.interceptors.request.use((config) => {
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
        if (typeof window !== "undefined" && window.location.pathname !== "/") {
          window.location.replace("/");
        }
        return Promise.reject(error);
      }

      originalRequest.headers = originalRequest.headers ?? {};
      return apiClient.request(originalRequest);
    } catch (refreshError) {
      clearStoredTokens();
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        window.location.replace("/");
      }
      return Promise.reject(refreshError);
    } finally {
      refreshTokenPromise = null;
    }
  },
);
