import axios from "axios";

import {
  buildLoginPath,
  clearStoredTokens,
  getApiBaseUrl,
} from "@/lib/auth";

/**
 * Sends the browser to the sign-in page when the session can no longer be
 * refreshed, keeping the current page so the user returns to it after signing
 * in (the same `?next=` the portal layout uses).
 */
function redirectToLogin() {
  if (typeof window === "undefined" || window.location.pathname === "/") {
    return;
  }
  const currentPath = `${window.location.pathname}${window.location.search}`;
  window.location.replace(buildLoginPath(currentPath));
}

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
    url &&
      (url.includes("/auth/login") ||
        url.includes("/auth/refresh") ||
        url.includes("/auth/password-reset")),
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
        redirectToLogin();
        return Promise.reject(error);
      }

      originalRequest.headers = originalRequest.headers ?? {};
      return apiClient.request(originalRequest);
    } catch (refreshError) {
      clearStoredTokens();
      redirectToLogin();
      return Promise.reject(refreshError);
    } finally {
      refreshTokenPromise = null;
    }
  },
);
