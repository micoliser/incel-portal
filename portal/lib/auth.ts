const ACCESS_TOKEN_KEY = "portal_access_token";
const REFRESH_TOKEN_KEY = "portal_refresh_token";

export function getStoredAccessToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getStoredRefreshToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setStoredTokens(accessToken: string, refreshToken: string) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearStoredTokens() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasStoredTokens() {
  return Boolean(getStoredAccessToken() && getStoredRefreshToken());
}

export function buildLoginPath(returnTo?: string) {
  if (!returnTo) return "/";

  const trimmed = returnTo.trim();
  if (!trimmed || trimmed === "/") return "/";

  const safePath =
    trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : "/";
  return safePath === "/" ? "/" : `/?next=${encodeURIComponent(safePath)}`;
}

export function getSafeReturnPath(rawValue: string | null | undefined) {
  if (!rawValue) return null;

  const decoded = decodeURIComponent(rawValue).trim();
  if (!decoded || !decoded.startsWith("/") || decoded.startsWith("//")) {
    return null;
  }

  return decoded;
}

export function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api/v1";
}
