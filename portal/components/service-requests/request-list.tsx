"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, RotateCcw, Search, X } from "lucide-react";

import { RequestStatusBadge } from "@/components/service-requests/status-badge";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { PageErrorCard } from "@/components/page-error-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/api/clients";
import {
  STATUS_LABELS,
  fetchRequests,
  type RequestStatus,
  type ServiceRequestSummary,
} from "@/lib/api/service-requests";
import { hasNextPage } from "@/lib/api/types";
import { extractApiErrorMessage } from "@/lib/api-errors";

const COLUMNS = 6;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

type Props = {
  /** Only the requests waiting for this person's approval. */
  awaitingMe?: boolean;
  empty: { title: string; message: string };
};

export function RequestList({ awaitingMe = false, empty }: Props) {
  const router = useRouter();
  const [requests, setRequests] = useState<ServiceRequestSummary[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [paymentType, setPaymentType] = useState("all");
  const [mine, setMine] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params: Record<string, string | number | boolean> = { page };
      if (search) params.search = search;
      if (status !== "all") params.status = status;
      if (paymentType !== "all") params.payment_type = paymentType;
      if (mine) params.mine = true;
      if (awaitingMe) params.awaiting_me = true;
      setLoading(true);
      try {
        const data = await fetchRequests(params);
        if (cancelled) return;
        setRequests((current) => (page === 1 ? data.results : [...current, ...data.results]));
        setCount(data.count);
        setHasMore(hasNextPage(data));
        setError("");
      } catch (err) {
        if (!cancelled) setError(extractApiErrorMessage(err, "Requests could not be loaded."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [page, search, status, paymentType, mine, awaitingMe, reloadKey]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) setPage((current) => current + 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  const filtersActive = Boolean(search) || status !== "all" || paymentType !== "all" || mine;
  const reset = () => {
    setSearchInput("");
    setStatus("all");
    setPaymentType("all");
    setMine(false);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <Card className="gap-0 rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              aria-label="Search requests"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by reference, client, passenger or PNR"
              className="h-10 pl-9 pr-9 rounded-lg text-xs sm:text-sm"
            />
            {searchInput ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            {!awaitingMe ? (
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
              >
                <SelectTrigger aria-label="Filter by status" className="h-10 w-full sm:w-44 rounded-lg text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(STATUS_LABELS) as RequestStatus[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {STATUS_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select
              value={paymentType}
              onValueChange={(value) => {
                setPaymentType(value);
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter by payment" className="h-10 w-full sm:w-44 rounded-lg text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Cash and credit</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
              </SelectContent>
            </Select>
            {!awaitingMe ? (
              <label className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-xs sm:text-sm">
                <input
                  type="checkbox"
                  checked={mine}
                  onChange={(event) => {
                    setMine(event.target.checked);
                    setPage(1);
                  }}
                  className="size-4 accent-[#0d47a1]"
                />
                Mine only
              </label>
            ) : null}
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={reset} className="h-10 px-3 text-xs text-muted-foreground">
                <RotateCcw className="mr-1.5 size-3.5" />
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {error && requests.length === 0 ? (
        <PageErrorCard
          title="Requests could not be loaded"
          message={error}
          onRetry={() => {
            setPage(1);
            setReloadKey((key) => key + 1);
          }}
        />
      ) : (
        <Card className="gap-0 py-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            {count} {count === 1 ? "request" : "requests"}
            {filtersActive ? " match" : ""}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                <tr>
                  <th className="px-4 py-3">Request</th>
                  <th className="px-4 py-3">PNR</th>
                  <th className="px-4 py-3 text-right">Selling price</th>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && requests.length === 0 ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: COLUMNS }).map((__, cell) => (
                        <td key={cell} className="px-4 py-4">
                          <Skeleton className="h-4 w-full max-w-32" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : requests.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS} className="px-4 py-14 text-center text-muted-foreground">
                      <ClipboardList className="size-8 mx-auto mb-2 opacity-40" aria-hidden="true" />
                      {filtersActive ? (
                        <>
                          <p className="font-medium text-foreground">No requests match</p>
                          <p className="text-xs mt-1">Try another search or reset the filters.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-foreground">{empty.title}</p>
                          <p className="text-xs mt-1">{empty.message}</p>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  requests.map((request) => (
                    <tr
                      key={request.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/service-requests/requests/${request.id}`)}
                    >
                      <td className="px-4 py-3.5 max-w-[420px]">
                        <Link
                          href={`/service-requests/requests/${request.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                          title={request.title}
                        >
                          {request.title}
                        </Link>
                        <span className="text-xs text-muted-foreground font-mono">{request.reference}</span>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap">{request.pnr}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                        {formatMoney(request.selling_price, "NGN")}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-sm">{request.payment_type === "cash" ? "Cash" : "Credit"}</span>
                        {request.party_type === "affiliate" ? (
                          <Badge variant="secondary" className="ml-2">
                            Affiliate
                          </Badge>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <RequestStatusBadge status={request.status} stage={request.approval_stage} />
                      </td>
                      <td className="px-4 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                        <span className="block text-sm text-foreground">{request.submitted_by.full_name}</span>
                        {formatDate(request.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div ref={sentinel} />
          <InfiniteScrollLoader isLoading={loading && requests.length > 0} entityName="requests" />
        </Card>
      )}
    </div>
  );
}
