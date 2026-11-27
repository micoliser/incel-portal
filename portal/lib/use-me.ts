"use client";

import { useEffect, useState } from "react";

import { apiClient } from "@/lib/api-client";

/** The signed-in user's rights that pages need to decide what to show. */
export type Me = {
  id: number;
  can_view_clients?: boolean;
  can_manage_clients?: boolean;
  can_view_requests?: boolean;
  can_submit_requests?: boolean;
  can_approve_requests?: boolean;
};

/** GET /me once per page; null until it has loaded (or if it fails). */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<Me>("/me")
      .then((response) => !cancelled && setMe(response.data))
      .catch(() => !cancelled && setMe(null));
    return () => {
      cancelled = true;
    };
  }, []);
  return me;
}
