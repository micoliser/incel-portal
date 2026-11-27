"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList, FileSpreadsheet, History, Loader2, Pencil, PlusCircle } from "lucide-react";

import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { PageErrorCard } from "@/components/page-error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api-client";
import {
  FIELD_LABELS,
  fetchClient,
  fetchClientHistory,
  formatMoney,
  isNegative,
  type ClientChange,
  type ClientFormValues,
  type CreditClient,
} from "@/lib/api/clients";
import { hasNextPage } from "@/lib/api/types";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const MONEY_FIELDS = new Set(["credit_limit", "credit_utilization"]);

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function changeValue(field: string, value: string, currency: string) {
  if (value === "" || value === "None") return "(empty)";
  if (MONEY_FIELDS.has(field)) return formatMoney(value, currency);
  if (field === "status") return value === "active" ? "Active" : "Inactive";
  return value;
}

function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<CreditClient | null>(null);
  const [error, setError] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [history, setHistory] = useState<ClientChange[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    apiClient
      .get<{ can_manage_clients?: boolean }>("/me")
      .then((response) => setCanManage(Boolean(response.data.can_manage_clients)))
      .catch(() => setCanManage(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchClient(id)
      .then((data) => !cancelled && (setClient(data), setError("")))
      .catch((err) => !cancelled && setError(extractApiErrorMessage(err, "This client could not be loaded.")));
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setHistoryLoading(true);
      try {
        const data = await fetchClientHistory(id, historyPage);
        if (cancelled) return;
        setHistory((current) => (historyPage === 1 ? data.results : [...current, ...data.results]));
        setHistoryMore(hasNextPage(data));
      } catch {
        // The history is secondary; the client itself still shows.
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, historyPage, reloadKey]);

  if (error && !client) {
    return <PageErrorCard title="Client not available" message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  if (!client) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const negative = isNegative(client.available_balance);

  return (
    <div className="space-y-6 max-w-full">
      <Link href="/service-requests/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All clients
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground break-words">{client.name}</h1>
            <Badge variant={client.status === "active" ? "success" : "secondary"}>
              {client.status === "active" ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            TIN <span className="font-mono">{client.tin}</span> · {client.currency} · {client.credit_days} credit days
          </p>
        </div>
        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="rounded-lg h-9.5">
            <Pencil className="mr-1.5 size-4" />
            Edit client
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="gap-0 rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground">Credit limit</span>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground">{formatMoney(client.credit_limit, client.currency)}</p>
        </Card>
        <Card className="gap-0 rounded-xl border border-border bg-card p-4 shadow-xs">
          <span className="text-xs font-medium text-muted-foreground">Credit utilization</span>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground">
            {formatMoney(client.credit_utilization, client.currency)}
          </p>
        </Card>
        <Card
          className={cn(
            "gap-0 rounded-xl border bg-card p-4 shadow-xs",
            negative ? "border-[#dc2626]/40 bg-[#dc2626]/5" : "border-border",
          )}
        >
          <span className="text-xs font-medium text-muted-foreground">Available balance</span>
          <p className={cn("mt-2 text-xl font-bold tabular-nums", negative ? "text-destructive-text" : "text-foreground")}>
            {formatMoney(client.available_balance, client.currency)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {negative ? "Over the limit: new requests will need approval." : "Credit limit minus utilization."}
          </p>
        </Card>
      </div>

      <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
        <h2 className="text-sm font-semibold text-foreground">Details</h2>
        <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Detail label="Contact person">{client.contact_person}</Detail>
          <Detail label="Phone">{client.phone}</Detail>
          <Detail label="Email">
            {client.email ? (
              <a href={`mailto:${client.email}`} className="hover:underline">
                {client.email}
              </a>
            ) : null}
          </Detail>
          <Detail label="Address">{client.address}</Detail>
          <Detail label="Notes" className="sm:col-span-2">
            {client.notes ? <span className="whitespace-pre-wrap">{client.notes}</span> : null}
          </Detail>
          <Detail label="Added">
            {formatWhen(client.created_at)}
            {client.created_by ? ` by ${client.created_by.full_name}` : ""}
          </Detail>
          <Detail label="Last changed">
            {formatWhen(client.updated_at)}
            {client.updated_by ? ` by ${client.updated_by.full_name}` : ""}
          </Detail>
        </dl>
      </Card>

      <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          History
        </h2>
        {historyLoading && history.length === 0 ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : history.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No changes recorded.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {history.map((entry) => {
              const Icon =
                entry.source === "imported"
                  ? FileSpreadsheet
                  : entry.source === "created"
                    ? PlusCircle
                    : entry.source === "request"
                      ? ClipboardList
                      : Pencil;
              const who = entry.changed_by?.full_name ?? "Someone";
              const what =
                entry.source === "created"
                  ? "added this client"
                  : entry.source === "imported"
                    ? Object.keys(entry.changes).length
                      ? `updated it from ${entry.file_name ?? "an import"}`
                      : `imported it from ${entry.file_name ?? "a spreadsheet"}`
                    : entry.source === "request"
                      ? `changed its balance: ${entry.note}`
                      : "edited it";
              return (
                <li key={entry.id} className="flex gap-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      <span className="font-medium">{who}</span> {what}
                      <span className="text-muted-foreground"> · {formatWhen(entry.created_at)}</span>
                    </p>
                    {Object.keys(entry.changes).length ? (
                      <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                        {Object.entries(entry.changes).map(([field, [before, after]]) => (
                          <li key={field} className="break-words">
                            <span className="font-medium text-foreground">
                              {FIELD_LABELS[field as keyof ClientFormValues] ?? field}
                            </span>
                            : {changeValue(field, before, client.currency)} →{" "}
                            <span className="text-foreground">{changeValue(field, after, client.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {historyMore ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4"
            disabled={historyLoading}
            onClick={() => setHistoryPage((current) => current + 1)}
          >
            {historyLoading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            Show older changes
          </Button>
        ) : null}
      </Card>

      <ClientFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        client={client}
        onSaved={(saved) => {
          setClient(saved);
          setHistoryPage(1);
          setReloadKey((key) => key + 1);
        }}
      />
    </div>
  );
}
