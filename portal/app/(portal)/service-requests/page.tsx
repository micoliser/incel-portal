"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useMe } from "@/lib/use-me";

/** Service Requests opens on the first part this person takes part in. */
export default function ServiceRequestsPage() {
  const router = useRouter();
  const me = useMe();
  useEffect(() => {
    if (!me) return;
    router.replace(me.can_view_requests ? "/service-requests/requests" : "/service-requests/clients");
  }, [me, router]);
  return null;
}
