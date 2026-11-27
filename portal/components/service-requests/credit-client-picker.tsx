"use client";

import { useEffect, useRef, useState } from "react";
import { Briefcase, Search, X } from "lucide-react";

import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchClients, formatMoney, isNegative, type CreditClient } from "@/lib/api/clients";
import { hasNextPage } from "@/lib/api/types";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

/** Active credit clients to pick from, searchable, with their credit at a glance. */
export function CreditClientPicker({ onPick }: { onPick: (client: CreditClient) => void }) {
  const [clients, setClients] = useState<CreditClient[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
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
      setLoading(true);
      try {
        const data = await fetchClients({ page, status: "active", ...(search ? { search } : {}) });
        if (cancelled) return;
        setClients((current) => (page === 1 ? data.results : [...current, ...data.results]));
        setHasMore(hasNextPage(data));
        setError("");
      } catch (err) {
        if (!cancelled) setError(extractApiErrorMessage(err, "Clients could not be loaded."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [page, search]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) setPage((current) => current + 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  return (
    <Card className="gap-0 py-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="border-b border-border p-3 sm:p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            aria-label="Search credit clients"
            autoFocus
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by name, TIN or contact person"
            className="h-10 pl-9 pr-9 rounded-lg text-sm"
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
      </div>
      {error && clients.length === 0 ? (
        <p role="alert" className="p-6 text-sm text-destructive-text">
          {error}
        </p>
      ) : loading && clients.length === 0 ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <div className="px-4 py-12 text-center text-muted-foreground">
          <Briefcase className="size-8 mx-auto mb-2 opacity-40" aria-hidden="true" />
          <p className="font-medium text-foreground">{search ? "No active client matches" : "No active credit clients"}</p>
          <p className="text-xs mt-1">
            {search ? "Try another name or TIN." : "Tourism Accounts adds credit clients under the Clients tab."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border" aria-label="Credit clients">
          {clients.map((client) => {
            const negative = isNegative(client.available_balance);
            return (
              <li key={client.id}>
                <button
                  type="button"
                  onClick={() => onPick(client)}
                  className="grid w-full gap-x-6 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none sm:grid-cols-[minmax(0,1fr)_repeat(3,9.5rem)] sm:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{client.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      TIN <span className="font-mono">{client.tin}</span> · {client.currency} · {client.credit_days} credit days
                    </span>
                  </span>
                  <span className="text-xs sm:text-right">
                    <span className="text-muted-foreground sm:block">Limit </span>
                    <span className="tabular-nums text-foreground">{formatMoney(client.credit_limit, client.currency)}</span>
                  </span>
                  <span className="text-xs sm:text-right">
                    <span className="text-muted-foreground sm:block">Utilization </span>
                    <span className="tabular-nums text-foreground">
                      {formatMoney(client.credit_utilization, client.currency)}
                    </span>
                  </span>
                  <span className="text-xs sm:text-right">
                    <span className="text-muted-foreground sm:block">Available </span>
                    <span className={cn("tabular-nums font-semibold", negative ? "text-destructive-text" : "text-foreground")}>
                      {formatMoney(client.available_balance, client.currency)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={sentinel} />
      <InfiniteScrollLoader isLoading={loading && clients.length > 0} entityName="clients" />
    </Card>
  );
}
