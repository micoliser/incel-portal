export function setStoredTokens(accessToken: string, refreshToken: string) {
  // Tokens are now stored in HttpOnly cookies by the backend.
}

export function clearStoredTokens() {
  // Tokens are managed via cookies; actual clearing happens via the /auth/logout API.
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
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
}
