"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

import { RequestList } from "@/components/service-requests/request-list";
import { Button } from "@/components/ui/button";
import { useMe } from "@/lib/use-me";

export default function RequestsPage() {
  const me = useMe();
  const canSubmit = Boolean(me?.can_submit_requests);

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every ticket request, from submission to issue. Open one to see its details and history.
          </p>
        </div>
        {canSubmit ? (
          <Button
            asChild
            size="sm"
            className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg px-4 h-9.5 text-xs sm:text-sm font-semibold shadow-sm"
          >
            <Link href="/service-requests/requests/new">
              <Plus className="mr-1.5 size-4" />
              New request
            </Link>
          </Button>
        ) : null}
      </div>
      <RequestList
        empty={{
          title: "No requests yet",
          message: canSubmit ? "Start one with New request." : "Requests appear here once Tourism / Operations submits them.",
        }}
      />
    </div>
  );
}
