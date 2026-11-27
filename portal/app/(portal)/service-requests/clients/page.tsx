"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Briefcase, FileUp, Pencil, Plus, RotateCcw, Search, X } from "lucide-react";

import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { PageErrorCard } from "@/components/page-error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api-client";
import { CURRENCIES, fetchClients, formatMoney, isNegative, type CreditClient } from "@/lib/api/clients";
import { hasNextPage } from "@/lib/api/types";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const COLUMNS = 8;

export default function ClientsPage() {
  const router = useRouter();
  const [canManage, setCanManage] = useState(false);
  const [clients, setClients] = useState<CreditClient[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CreditClient | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiClient
      .get<{ can_manage_clients?: boolean }>("/me")
      .then((response) => setCanManage(Boolean(response.data.can_manage_clients)))
      .catch(() => setCanManage(false));
  }, []);

  // A new search, filter or reload starts again from the first page.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);
  const changeStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  const changeCurrency = (value: string) => {
    setCurrency(value);
    setPage(1);
  };
  const reload = () => {
    setPage(1);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const params: Record<string, string | number> = { page };
      if (search) params.search = search;
      if (status !== "all") params.status = status;
      if (currency !== "all") params.currency = currency;
      setLoading(true);
      try {
        const data = await fetchClients(params);
        if (cancelled) return;
        setClients((current) => (page === 1 ? data.results : [...current, ...data.results]));
        setCount(data.count);
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
  }, [page, search, status, currency, reloadKey]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !loading) setPage((current) => current + 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading]);

  const filtersActive = Boolean(search) || status !== "all" || currency !== "all";
  const resetFilters = () => {
    setSearchInput("");
    setStatus("all");
    setCurrency("all");
    setPage(1);
  };

  const handleSaved = (saved: CreditClient) => {
    if (editing) {
      setClients((current) => current.map((client) => (client.id === saved.id ? saved : client)));
    } else {
      reload();
    }
  };

  return (
    <div className="space-y-6 max-w-full">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Credit clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Clients who take services on credit, their limits and what they have left to use.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="outline" size="sm" asChild className="rounded-lg h-9.5 text-xs sm:text-sm font-medium">
              <Link href="/service-requests/clients/import">
                <FileUp className="mr-1.5 size-4" />
                Import spreadsheet
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg px-4 h-9.5 text-xs sm:text-sm font-semibold shadow-sm"
            >
              <Plus className="mr-1.5 size-4" />
              Add client
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="gap-0 rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              aria-label="Search clients"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by name, TIN, contact person or email"
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
            <Select value={status} onValueChange={changeStatus}>
              <SelectTrigger aria-label="Filter by status" className="h-10 w-full sm:w-36 rounded-lg text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={currency} onValueChange={changeCurrency}>
              <SelectTrigger aria-label="Filter by currency" className="h-10 w-full sm:w-36 rounded-lg text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All currencies</SelectItem>
                {CURRENCIES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive ? (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-10 px-3 text-xs text-muted-foreground">
                <RotateCcw className="mr-1.5 size-3.5" />
                Reset
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {error && clients.length === 0 ? (
        <PageErrorCard title="Clients could not be loaded" message={error} onRetry={reload} />
      ) : (
        <Card className="gap-0 py-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {count} {count === 1 ? "client" : "clients"}
              {filtersActive ? " match" : ""}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                <tr>
                  <th className="px-4 py-3">Client</th>
                  <th className="px-4 py-3">TIN</th>
                  <th className="px-4 py-3 text-right">Credit limit</th>
                  <th className="px-4 py-3 text-right">Utilization</th>
                  <th className="px-4 py-3 text-right">Available balance</th>
                  <th className="px-4 py-3 text-right">Credit days</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && clients.length === 0 ? (
                  Array.from({ length: 6 }).map((_, index) => (
                    <tr key={index}>
                      {Array.from({ length: COLUMNS }).map((__, cell) => (
                        <td key={cell} className="px-4 py-4">
                          <Skeleton className="h-4 w-full max-w-32" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : clients.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS} className="px-4 py-14 text-center text-muted-foreground">
                      <Briefcase className="size-8 mx-auto mb-2 opacity-40" aria-hidden="true" />
                      {filtersActive ? (
                        <>
                          <p className="font-medium text-foreground">No clients match</p>
                          <p className="text-xs mt-1">Try another search or reset the filters.</p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-foreground">No credit clients yet</p>
                          <p className="text-xs mt-1">
                            {canManage
                              ? "Add a client, or import your existing list from a spreadsheet."
                              : "Clients appear here once Tourism Accounts or the Operations supervisor adds them."}
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  clients.map((client) => (
                    <tr
                      key={client.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/service-requests/clients/${client.id}`)}
                    >
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/service-requests/clients/${client.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="font-medium text-foreground hover:text-primary hover:underline block max-w-[260px] truncate"
                          title={client.name}
                        >
                          {client.name}
                        </Link>
                        {client.contact_person ? (
                          <span className="text-xs text-muted-foreground block truncate max-w-[260px]">
                            {client.contact_person}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-xs whitespace-nowrap">{client.tin}</td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap">
                        {formatMoney(client.credit_limit, client.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums whitespace-nowrap text-muted-foreground">
                        {formatMoney(client.credit_utilization, client.currency)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3.5 text-right tabular-nums whitespace-nowrap font-semibold",
                          isNegative(client.available_balance) ? "text-destructive-text" : "text-foreground",
                        )}
                      >
                        {formatMoney(client.available_balance, client.currency)}
                      </td>
                      <td className="px-4 py-3.5 text-right tabular-nums">{client.credit_days}</td>
                      <td className="px-4 py-3.5">
                        <Badge variant={client.status === "active" ? "success" : "secondary"}>
                          {client.status === "active" ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {canManage ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Edit ${client.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditing(client);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div ref={sentinel} />
          <InfiniteScrollLoader isLoading={loading && clients.length > 0} entityName="clients" />
        </Card>
      )}

      <ClientFormDialog open={formOpen} onOpenChange={setFormOpen} client={editing} onSaved={handleSaved} />
    </div>
  );
}
