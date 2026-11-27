"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  FileText,
  History,
  Loader2,
  Send,
  ShieldCheck,
  ShieldX,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { RequestStatusBadge } from "@/components/service-requests/status-badge";
import { PageErrorCard } from "@/components/page-error-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, isNegative } from "@/lib/api/clients";
import {
  approveRequest,
  cancelRequest,
  completeRequest,
  evidenceLink,
  fetchRequest,
  fetchRequestHistory,
  rejectRequest,
  type RequestEvent,
  type ServiceRequestDetail,
} from "@/lib/api/service-requests";
import { hasNextPage } from "@/lib/api/types";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const EVENT_TEXT: Record<RequestEvent["action"], string> = {
  submitted: "submitted the request",
  sent_for_approval: "submitted the request; it went for approval",
  first_approved: "gave the first approval",
  approved: "gave the final approval",
  rejected: "rejected it",
  completed: "marked it completed",
  cancelled: "cancelled it",
};
const EVENT_ICON: Record<RequestEvent["action"], typeof Send> = {
  submitted: Send,
  sent_for_approval: Send,
  first_approved: ShieldCheck,
  approved: ShieldCheck,
  rejected: ShieldX,
  completed: CheckCircle2,
  cancelled: Ban,
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function day(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function Detail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground break-words">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function naira(value: string | null) {
  return value === null ? null : formatMoney(value, "NGN");
}

type ReasonAction = "reject" | "cancel";

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<ServiceRequestDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<ReasonAction | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [history, setHistory] = useState<RequestEvent[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyMore, setHistoryMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchRequest(id)
      .then((data) => !cancelled && (setRequest(data), setError("")))
      .catch((err) => !cancelled && setError(extractApiErrorMessage(err, "This request could not be loaded.")));
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setHistoryLoading(true);
      try {
        const data = await fetchRequestHistory(id, historyPage);
        if (cancelled) return;
        setHistory((current) => (historyPage === 1 ? data.results : [...current, ...data.results]));
        setHistoryMore(hasNextPage(data));
      } catch {
        // The history is secondary; the request itself still shows.
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, historyPage, reloadKey]);

  async function act(name: string, run: () => Promise<ServiceRequestDetail>, done: string) {
    setBusy(name);
    try {
      setRequest(await run());
      setHistoryPage(1);
      setReloadKey((key) => key + 1);
      toast.success(done);
      return true;
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "That did not go through. Refresh and try again."));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitReason() {
    if (!request || !reasonFor) return;
    if (!reason.trim()) {
      setReasonError("Give a reason.");
      return;
    }
    const ok =
      reasonFor === "reject"
        ? await act("reject", () => rejectRequest(request.id, reason.trim()), "Request rejected.")
        : await act("cancel", () => cancelRequest(request.id, reason.trim()), "Request cancelled.");
    if (ok) {
      setReasonFor(null);
      setReason("");
    }
  }

  async function openEvidence() {
    if (!request) return;
    setBusy("evidence");
    try {
      window.open(await evidenceLink(request.id), "_blank", "noopener");
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "The file could not be opened."));
    } finally {
      setBusy(null);
    }
  }

  if (error && !request) {
    return <PageErrorCard title="Request not available" message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }
  if (!request) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-96 max-w-full" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const ticket = request.ticket;
  const allowed = request.allowed;
  const credit = request.credit;
  const pending = request.status === "pending_approval";
  const closed = request.status === "cancelled" || request.status === "rejected";

  return (
    <div className="space-y-6 max-w-full">
      <Link
        href="/service-requests/requests"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All requests
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{request.reference}</span>
            <RequestStatusBadge status={request.status} stage={request.approval_stage} />
            {request.party_type === "affiliate" ? <Badge variant="secondary">Affiliate</Badge> : null}
          </div>
          <h1 className="mt-1.5 text-xl sm:text-2xl font-bold tracking-tight text-foreground break-words">{request.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {request.payment_type === "cash" ? "Cash" : "Credit"} · submitted by {request.submitted_by.full_name} on{" "}
            {when(request.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {allowed.complete ? (
            <Button
              onClick={() => setConfirmComplete(true)}
              disabled={busy !== null}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
            >
              <CheckCircle2 className="mr-1.5 size-4" />
              Mark completed
            </Button>
          ) : null}
          {allowed.cancel ? (
            <Button variant="outline" onClick={() => setReasonFor("cancel")} disabled={busy !== null}>
              <XCircle className="mr-1.5 size-4" />
              Cancel request
            </Button>
          ) : null}
          {allowed.copy ? (
            <Button asChild variant="outline">
              <Link href={`/service-requests/requests/new?from=${request.id}`}>
                <Copy className="mr-1.5 size-4" />
                New request from this one
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {pending ? (
        <Card className="gap-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="font-semibold text-foreground">
                {request.approval_stage === "first" ? "Waiting for the first approval" : "Waiting for the ED's final approval"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {request.approval_stage === "first"
                  ? "The Sales supervisor, the Operations supervisor or the Tourism manager approves first, then the ED."
                  : "The first approval is given. The ED approves last; the client's balance changes then."}
                {allowed.approve ? "" : " The ticket is not issued until then."}
              </p>
            </div>
            {allowed.approve ? (
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" onClick={() => setReasonFor("reject")} disabled={busy !== null}>
                  <ShieldX className="mr-1.5 size-4" />
                  Reject
                </Button>
                <Button
                  onClick={() =>
                    act(
                      "approve",
                      () => approveRequest(request.id),
                      request.approval_stage === "first" ? "First approval given." : "Request approved.",
                    )
                  }
                  disabled={busy !== null}
                  className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
                >
                  {busy === "approve" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <ShieldCheck className="mr-1.5 size-4" />}
                  {request.approval_stage === "first" ? "Give first approval" : "Give final approval"}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {closed && request.closed_reason ? (
        <Card className="gap-0 rounded-xl border border-border bg-muted/40 p-5 shadow-xs">
          <p className="text-sm font-semibold text-foreground">
            {request.status === "rejected" ? "Rejected" : "Cancelled"}: why
          </p>
          <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{request.closed_reason}</p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-5 min-w-0">
          <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
            <h2 className="text-sm font-semibold text-foreground">Ticket</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
              <Detail label={request.party_type === "affiliate" ? "Affiliate" : "Client"}>{request.client_name}</Detail>
              <Detail label="Passengers" className="sm:col-span-2">
                <ul className="space-y-0.5">
                  {ticket.passengers.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </Detail>
              <Detail label="Airline">{ticket.airline}</Detail>
              <Detail label="PNR">
                <span className="font-mono">{ticket.pnr}</span>
              </Detail>
              <Detail label="Route">
                <span className="font-mono">{ticket.route}</span>
              </Detail>
              <Detail label="Departure">{day(ticket.departure_date)}</Detail>
              <Detail label="Return">{ticket.return_date ? day(ticket.return_date) : null}</Detail>
              <Detail label="Vendor / processing agent">{ticket.vendor}</Detail>
            </dl>
          </Card>

          <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
            <h2 className="text-sm font-semibold text-foreground">Pricing</h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <Detail label="Selling price">{naira(request.selling_price)}</Detail>
              <Detail label="Cost price">{naira(request.cost_price)}</Detail>
              <Detail label="Revenue">
                <span className={cn("font-semibold", isNegative(request.revenue) && "text-destructive-text")}>
                  {naira(request.revenue)}
                </span>
              </Detail>
              {ticket.published_fare !== null ? (
                <>
                  <Detail label="Published fare">{naira(ticket.published_fare)}</Detail>
                  <Detail label="Net commission (after WHT)">{naira(ticket.net_commission)}</Detail>
                  <Detail label="Commission given to the customer">{naira(ticket.commission_given)}</Detail>
                  <Detail label="Balance commission for the company">{naira(ticket.balance_commission)}</Detail>
                </>
              ) : null}
              {request.foreign_amount !== null ? (
                <>
                  <Detail label="Amount in other currency">
                    {formatMoney(request.foreign_amount, request.foreign_currency)}
                  </Detail>
                  <Detail label="Exchange rate">
                    ₦{Number(request.exchange_rate).toLocaleString("en-NG")} per {request.foreign_currency}
                  </Detail>
                </>
              ) : null}
            </dl>
          </Card>

          {request.payment_type === "cash" ? (
            <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
              <h2 className="text-sm font-semibold text-foreground">Payment</h2>
              <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Detail label="Amount received">{naira(request.amount_paid)}</Detail>
                <Detail label="Payment evidence">
                  {request.evidence ? (
                    <button
                      type="button"
                      onClick={openEvidence}
                      disabled={busy === "evidence"}
                      className="inline-flex max-w-full items-center gap-1.5 text-[#0d47a1] hover:underline dark:text-[#38bdf8]"
                    >
                      {busy === "evidence" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4 shrink-0" />}
                      <span className="truncate">{request.evidence.file_name}</span>
                    </button>
                  ) : null}
                </Detail>
              </dl>
            </Card>
          ) : null}

          <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <History className="size-4 text-muted-foreground" aria-hidden="true" />
              History
            </h2>
            {historyLoading && history.length === 0 ? (
              <div className="mt-4 space-y-3">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (
              <ol className="mt-4 space-y-4">
                {history.map((event) => {
                  const Icon = EVENT_ICON[event.action];
                  return (
                    <li key={event.id} className="flex gap-3">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">
                          <span className="font-medium">{event.actor?.full_name ?? "Someone"}</span> {EVENT_TEXT[event.action]}
                          <span className="text-muted-foreground"> · {when(event.created_at)}</span>
                        </p>
                        {event.note ? <p className="mt-0.5 text-xs text-muted-foreground break-words">{event.note}</p> : null}
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
                Show older entries
              </Button>
            ) : null}
          </Card>
        </div>

        {credit ? (
          <Card
            className={cn(
              "gap-0 rounded-xl border bg-card p-5 shadow-xs lg:sticky lg:top-4",
              isNegative(credit.balance_after_request) ? "border-amber-500/50" : "border-border",
            )}
          >
            <h2 className="text-sm font-semibold text-foreground">Credit status when submitted</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {(
                [
                  ["Approved credit limit", credit.credit_limit],
                  ["Current utilization", credit.utilization],
                  ["Available balance", credit.available_balance],
                  ["Requested amount", credit.requested_amount],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums">{formatMoney(value, credit.currency)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                <dt>Balance after request</dt>
                <dd className={cn("tabular-nums", isNegative(credit.balance_after_request) && "text-destructive-text")}>
                  {formatMoney(credit.balance_after_request, credit.currency)}
                </dd>
              </div>
            </dl>
            {request.decisions.length ? (
              <div className="mt-4 space-y-2 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Approvals</p>
                {request.decisions.map((decision) => (
                  <p key={decision.id} className="text-sm">
                    <span className={decision.decision === "approved" ? "text-success-text" : "text-destructive-text"}>
                      {decision.decision === "approved" ? "Approved" : "Rejected"}
                    </span>{" "}
                    ({decision.stage === "first" ? "first" : "final"}) by {decision.decided_by.full_name}
                    <span className="block text-xs text-muted-foreground">{when(decision.created_at)}</span>
                  </p>
                ))}
              </div>
            ) : null}
            {request.client_id ? (
              <Link
                href={`/service-requests/clients/${request.client_id}`}
                className="mt-4 inline-block text-xs text-[#0d47a1] hover:underline dark:text-[#38bdf8]"
              >
                Open the client
              </Link>
            ) : null}
          </Card>
        ) : null}
      </div>

      <Dialog open={reasonFor !== null} onOpenChange={(open) => !busy && !open && setReasonFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{reasonFor === "reject" ? "Reject this request" : "Cancel this request"}</DialogTitle>
            <DialogDescription>
              {reasonFor === "reject"
                ? "The submitter and everyone involved are told why. The client's balance does not change."
                : request.payment_type === "credit" && request.status !== "pending_approval"
                  ? "Everyone involved is told why, and the amount goes back to the client's balance. You can start a new request from this one."
                  : "Everyone involved is told why. You can start a new request from this one."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={reason}
              maxLength={1000}
              rows={3}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError("");
              }}
              aria-invalid={Boolean(reasonError)}
            />
            {reasonError ? <p className="text-xs text-destructive-text">{reasonError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)} disabled={busy !== null}>
              Go back
            </Button>
            <Button onClick={submitReason} disabled={busy !== null} className="bg-[#0d47a1] hover:bg-[#0a3880] text-white">
              {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {reasonFor === "reject" ? "Reject request" : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmComplete} onOpenChange={(open) => !busy && setConfirmComplete(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark the ticket as issued?</DialogTitle>
            <DialogDescription>
              Completed means the ticket has been issued. Everyone involved is told, and the request can no longer be
              cancelled.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmComplete(false)} disabled={busy !== null}>
              Go back
            </Button>
            <Button
              onClick={async () => {
                if (await act("complete", () => completeRequest(request.id), "Request marked completed.")) {
                  setConfirmComplete(false);
                  router.refresh();
                }
              }}
              disabled={busy !== null}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
            >
              {busy === "complete" ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              Mark completed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
