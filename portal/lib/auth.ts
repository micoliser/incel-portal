export function setStoredTokens(...args: unknown[]) {
  void args;
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

export interface UserRoleInput {
  role?: string | null;
  role_code?: string | null;
  manager_scope?: {
    role_type?: "global" | "department" | "unit" | "team" | string;
    title?: string;
  } | null;
  is_manager?: boolean;
}

/**
 * Resolves the appropriate role label for display in headers and banners:
 * - ED for Executive Director
 * - MD for Managing Director
 * - Line Manager for department line managers
 * - Supervisor for unit supervisors
 * - Team Lead for team leads
 * - Staff for everyone in no managerial position
 */
export function getUserRoleLabel(user?: UserRoleInput | null): string {
  if (!user) return "Staff";

  const rawRole = (user.role || "").trim();
  const rawRoleCode = (user.role_code || "").trim().toUpperCase();

  // 1. Executive Roles (ED, MD)
  if (
    rawRoleCode === "ED" ||
    rawRole.toUpperCase() === "ED" ||
    rawRole.toLowerCase() === "executive director"
  ) {
    return "ED";
  }
  if (
    rawRoleCode === "MD" ||
    rawRole.toUpperCase() === "MD" ||
    rawRole.toLowerCase() === "managing director"
  ) {
    return "MD";
  }

  // 2. Admin
  if (
    rawRoleCode === "ADMIN" ||
    rawRole.toLowerCase() === "admin" ||
    rawRole.toLowerCase() === "administrator"
  ) {
    return "Admin";
  }

  // 3. Managerial Roles: Line Manager, Supervisor, Team Lead
  const scopeType = user.manager_scope?.role_type?.toLowerCase();
  const scopeTitle = (user.manager_scope?.title || "").toLowerCase();
  const roleLower = rawRole.toLowerCase();

  // Line Manager (department level)
  if (
    scopeType === "department" ||
    rawRoleCode === "LINE_MANAGER" ||
    roleLower === "line manager" ||
    roleLower === "department manager" ||
    scopeTitle.includes("line manager")
  ) {
    return "Line Manager";
  }

  // Supervisor (unit level)
  if (
    scopeType === "unit" ||
    rawRoleCode === "SUPERVISOR" ||
    rawRoleCode === "UNIT_SUPERVISOR" ||
    roleLower === "supervisor" ||
    roleLower === "unit supervisor" ||
    scopeTitle.includes("supervisor")
  ) {
    return "Supervisor";
  }

  // Team Lead (team level)
  if (
    scopeType === "team" ||
    rawRoleCode === "TEAM_LEAD" ||
    rawRoleCode === "TEAMLEAD" ||
    roleLower === "team lead" ||
    roleLower === "teamlead" ||
    scopeTitle.includes("team lead")
  ) {
    return "Team Lead";
  }

  // If role is explicitly one of the manager titles
  if (
    rawRole === "Line Manager" ||
    rawRole === "Supervisor" ||
    rawRole === "Team Lead"
  ) {
    return rawRole;
  }

  // 4. Fallback: Anyone in no managerial position shows "Staff"
  return "Staff";
}
