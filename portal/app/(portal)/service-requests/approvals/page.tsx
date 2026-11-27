"use client";

import { RequestList } from "@/components/service-requests/request-list";

export default function ApprovalsPage() {
  return (
    <div className="space-y-6 max-w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Waiting for your approval</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Credit requests that would take a client over its limit. Open one to approve or reject it.
        </p>
      </div>
      <RequestList
        awaitingMe
        empty={{ title: "Nothing is waiting for you", message: "Requests that need your approval appear here." }}
      />
    </div>
  );
}
