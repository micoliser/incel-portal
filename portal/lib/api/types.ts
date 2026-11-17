/** The shape every paginated list endpoint returns. */
export interface Paginated<T> {
  count: number;
  page: number;
  page_size: number;
  total_pages: number;
  results: T[];
}

/** True when a paginated response has at least one more page after this one. */
export function hasNextPage(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const { page, total_pages } = payload as Partial<Paginated<unknown>>;
  return typeof page === "number" && typeof total_pages === "number" && page < total_pages;
}

/** How a user appears wherever another record refers to one. */
export interface UserSummary {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_active: boolean;
}
