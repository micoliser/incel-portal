"use client";

import { useRef, useState } from "react";
import { AlertTriangle, FileText, Loader2, Lock, Plus, Trash2, Upload, X } from "lucide-react";

import { SuggestInput } from "@/components/service-requests/suggest-input";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fieldErrors, formatMoney, type CreditClient } from "@/lib/api/clients";
import {
  EVIDENCE_ACCEPT,
  EVIDENCE_MAX_BYTES,
  EVIDENCE_TYPES,
  FOREIGN_CURRENCIES,
  amountOrNull,
  parseAmount,
  submitTicket,
  uploadEvidence,
  type Evidence,
  type PartyType,
  type PaymentType,
  type ServiceRequestDetail,
  type TicketPayload,
} from "@/lib/api/service-requests";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

export type TicketFormValues = {
  party_type: PartyType;
  client_name: string;
  passengers: string[];
  airline: string;
  pnr: string;
  departure_date: string;
  return_date: string;
  route: string;
  vendor: string;
  published_fare: string;
  net_commission: string;
  commission_given: string;
  selling_price: string;
  cost_price: string;
  foreign_currency: string;
  foreign_amount: string;
  exchange_rate: string;
  amount_paid: string;
  evidence: Evidence | null;
};

export const EMPTY_TICKET: TicketFormValues = {
  party_type: "client",
  client_name: "",
  passengers: [""],
  airline: "",
  pnr: "",
  departure_date: "",
  return_date: "",
  route: "",
  vendor: "",
  published_fare: "",
  net_commission: "",
  commission_given: "",
  selling_price: "",
  cost_price: "",
  foreign_currency: "",
  foreign_amount: "",
  exchange_rate: "",
  amount_paid: "",
  evidence: null,
};

/** The form's values from an earlier request, for "New request from this one". */
export function valuesFromRequest(request: ServiceRequestDetail): TicketFormValues {
  const ticket = request.ticket;
  const text = (value: string | null | undefined) => value ?? "";
  const discount = Boolean(ticket.published_fare);
  return {
    party_type: request.party_type,
    client_name: request.payment_type === "cash" ? request.client_name : "",
    passengers: ticket.passengers.length ? ticket.passengers : [""],
    airline: ticket.airline,
    pnr: ticket.pnr,
    departure_date: ticket.departure_date,
    return_date: text(ticket.return_date),
    route: ticket.route,
    vendor: ticket.vendor,
    published_fare: text(ticket.published_fare),
    net_commission: text(ticket.net_commission),
    commission_given: text(ticket.commission_given),
    selling_price: request.selling_price,
    cost_price: discount ? "" : request.cost_price,
    foreign_currency: request.foreign_currency,
    foreign_amount: text(request.foreign_amount),
    exchange_rate: text(request.exchange_rate),
    amount_paid: text(request.amount_paid),
    evidence: request.evidence,
  };
}

function naira(value: number) {
  return formatMoney(value, "NGN");
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive-text">
      {message}
    </p>
  );
}

type Props = {
  paymentType: PaymentType;
  client: CreditClient | null;
  initial: TicketFormValues;
  createdFrom: string | null;
  onSubmitted: (request: ServiceRequestDetail) => void;
  onBack: () => void;
};

export function TicketForm({ paymentType, client, initial, createdFrom, onSubmitted, onBack }: Props) {
  const [values, setValues] = useState<TicketFormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmZero, setConfirmZero] = useState(false);
  const [showDiscount, setShowDiscount] = useState(Boolean(initial.published_fare));
  const fileRef = useRef<HTMLInputElement | null>(null);

  const credit = paymentType === "credit" && client !== null;
  const foreignClient = credit && client.currency !== "NGN";
  const affiliate = values.party_type === "affiliate";
  const discountShown = affiliate || showDiscount;

  const set = <K extends keyof TicketFormValues>(field: K, value: TicketFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field as string]) return current;
      const next = { ...current };
      delete next[field as string];
      return next;
    });
  };

  // Live figures, the same sums the API checks.
  const fare = parseAmount(values.published_fare);
  const net = parseAmount(values.net_commission);
  const given = parseAmount(values.commission_given);
  const discountComplete = discountShown && fare !== null && net !== null && given !== null;
  const costFromDiscount = discountComplete ? fare - given : null;
  const balanceCommission = discountComplete ? net - given : null;
  const selling = parseAmount(values.selling_price);
  const cost = discountShown ? costFromDiscount : parseAmount(values.cost_price);
  const revenue = selling !== null && cost !== null ? selling - cost : null;
  const foreignAmount = parseAmount(values.foreign_amount);
  const rate = parseAmount(values.exchange_rate);
  const converted = foreignAmount !== null && rate !== null ? foreignAmount * rate : null;
  const foreignCurrency = foreignClient ? client.currency : values.foreign_currency;
  const coverageShort = converted !== null && selling !== null && converted < selling;
  const requested = credit ? (foreignClient ? foreignAmount : selling) : null;
  const available = credit ? Number(client.available_balance) : null;
  const balanceAfter = credit && requested !== null && available !== null ? available - requested : null;
  const needsApproval = balanceAfter !== null && balanceAfter < 0;
  const paidShort = paymentType === "cash" && selling !== null && parseAmount(values.amount_paid) !== null
    && (parseAmount(values.amount_paid) as number) < selling;

  async function chooseEvidence(file: File) {
    if (!EVIDENCE_TYPES.includes(file.type)) {
      setErrors((current) => ({ ...current, evidence: "Payment evidence must be an image or a PDF." }));
      return;
    }
    if (file.size > EVIDENCE_MAX_BYTES) {
      setErrors((current) => ({ ...current, evidence: "Payment evidence must be 5 MB or smaller." }));
      return;
    }
    setUploading(true);
    try {
      set("evidence", await uploadEvidence(file));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        evidence: error instanceof Error && !("isAxiosError" in error)
          ? error.message
          : extractApiErrorMessage(error, "The file could not be uploaded. Try again."),
      }));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function payload(confirmZeroRevenue: boolean): TicketPayload {
    return {
      payment_type: paymentType,
      party_type: values.party_type,
      client_id: credit ? client.id : null,
      client_name: credit ? undefined : values.client_name.trim(),
      passengers: values.passengers.map((name) => name.trim()).filter(Boolean),
      airline: values.airline.trim(),
      pnr: values.pnr.trim(),
      departure_date: values.departure_date,
      return_date: values.return_date || null,
      route: values.route.trim(),
      vendor: values.vendor.trim(),
      published_fare: discountShown ? amountOrNull(values.published_fare) : null,
      net_commission: discountShown ? amountOrNull(values.net_commission) : null,
      commission_given: discountShown ? amountOrNull(values.commission_given) : null,
      selling_price: amountOrNull(values.selling_price) ?? "",
      cost_price: discountShown ? null : amountOrNull(values.cost_price),
      confirm_zero_revenue: confirmZeroRevenue,
      foreign_currency: foreignClient ? client.currency : values.foreign_currency,
      foreign_amount: amountOrNull(values.foreign_amount),
      exchange_rate: amountOrNull(values.exchange_rate),
      amount_paid: paymentType === "cash" ? amountOrNull(values.amount_paid) : null,
      evidence: paymentType === "cash" ? values.evidence : null,
      created_from: createdFrom,
    };
  }

  async function send(confirmZeroRevenue: boolean) {
    setSubmitting(true);
    try {
      onSubmitted(await submitTicket(payload(confirmZeroRevenue)));
    } catch (error) {
      const byField = fieldErrors(error);
      if (byField.confirm_zero_revenue && Object.keys(byField).length === 1) {
        setConfirmZero(true);
      } else if (Object.keys(byField).length) {
        delete byField.confirm_zero_revenue;
        setErrors(byField);
        window.requestAnimationFrame(() => {
          document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
        });
      } else {
        setErrors({ form: extractApiErrorMessage(error, "The request could not be submitted.") });
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (revenue === 0) {
      setConfirmZero(true);
      return;
    }
    void send(false);
  }

  const input = (
    field: keyof TicketFormValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    required = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ticket-${field}`}>
        <span>
          {label}
          {required ? <span className="text-destructive-text"> *</span> : null}
        </span>
      </Label>
      <Input
        id={`ticket-${field}`}
        value={values[field] as string}
        onChange={(event) => set(field, event.target.value as never)}
        aria-invalid={Boolean(errors[field])}
        aria-describedby={errors[field] ? `ticket-${field}-error` : undefined}
        className={cn(errors[field] && "border-destructive")}
        {...props}
      />
      <FieldError id={`ticket-${field}-error`} message={errors[field]} />
    </div>
  );

  const partyLabel = affiliate ? "Affiliate" : "Client";

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="space-y-5 min-w-0">
        <Section title="Client and passengers">
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Booking for</legend>
            <div className="mt-2 inline-flex rounded-lg border border-border bg-muted/60 p-1">
              {(["client", "affiliate"] as const).map((type) => (
                <label
                  key={type}
                  className={cn(
                    "cursor-pointer rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    values.party_type === type ? "bg-[#0d47a1] text-white shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <input
                    type="radio"
                    name="party_type"
                    value={type}
                    checked={values.party_type === type}
                    onChange={() => set("party_type", type)}
                    className="sr-only"
                  />
                  {type === "client" ? "Client" : "Affiliate"}
                </label>
              ))}
            </div>
            {affiliate ? (
              <p className="mt-2 text-xs text-muted-foreground">Affiliate tickets need the full discount section.</p>
            ) : null}
          </fieldset>

          {credit ? (
            <div className="sm:col-span-2 space-y-1.5">
              <span className="text-sm font-medium">{partyLabel}</span>
              <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm">
                {client.name}
              </p>
            </div>
          ) : (
            <div className="sm:col-span-2">
              {input("client_name", `${partyLabel} name`, { maxLength: 200, placeholder: affiliate ? "DEGENIUSTRAVELS" : "AFRIWINGS" }, true)}
            </div>
          )}

          <div className="sm:col-span-2 space-y-2">
            <span className="text-sm font-medium">
              Passengers<span className="text-destructive-text"> *</span>
            </span>
            {values.passengers.map((name, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={`Passenger ${index + 1}`}
                  value={name}
                  maxLength={150}
                  placeholder="SURNAME/FIRST NAME"
                  aria-invalid={Boolean(errors.passengers) && !name.trim()}
                  onChange={(event) =>
                    set("passengers", values.passengers.map((current, i) => (i === index ? event.target.value : current)))
                  }
                />
                {values.passengers.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove passenger ${index + 1}`}
                    onClick={() => set("passengers", values.passengers.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => set("passengers", [...values.passengers, ""])}
            >
              <Plus className="mr-1.5 size-3.5" />
              Add passenger
            </Button>
            <FieldError id="ticket-passengers-error" message={errors.passengers} />
          </div>
        </Section>

        <Section title="Flight">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-airline">
              <span>
                Airline<span className="text-destructive-text"> *</span>
              </span>
            </Label>
            <SuggestInput
              id="ticket-airline"
              field="airline"
              value={values.airline}
              onValueChange={(value) => set("airline", value)}
              maxLength={100}
              aria-invalid={Boolean(errors.airline)}
            />
            <FieldError id="ticket-airline-error" message={errors.airline} />
          </div>
          {input("pnr", "PNR / booking reference", { maxLength: 8, placeholder: "e.g. AB3ZKB", className: "font-mono" }, true)}
          {input("departure_date", "Departure date", { type: "date" }, true)}
          {input("return_date", "Return date", { type: "date", min: values.departure_date || undefined })}
          {input("route", "Route", { maxLength: 100, placeholder: "e.g. LOS-ABV or LOS-SEZ-LOS", className: "font-mono" }, true)}
          <div className="space-y-1.5">
            <Label htmlFor="ticket-vendor">
              <span>
                Vendor / processing agent<span className="text-destructive-text"> *</span>
              </span>
            </Label>
            <SuggestInput
              id="ticket-vendor"
              field="vendor"
              value={values.vendor}
              onValueChange={(value) => set("vendor", value)}
              maxLength={150}
              aria-invalid={Boolean(errors.vendor)}
            />
            <FieldError id="ticket-vendor-error" message={errors.vendor} />
          </div>
        </Section>

        <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Discount</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {affiliate
                  ? "Required for affiliates. The cost price is worked out from it."
                  : "Only when the airline gives a commission. The cost price is then worked out from it."}
              </p>
            </div>
            {!affiliate ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showDiscount}
                  onChange={(event) => setShowDiscount(event.target.checked)}
                  className="size-4 accent-[#0d47a1]"
                />
                Airline commission
              </label>
            ) : null}
          </div>
          {discountShown ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {input("published_fare", "Published fare (₦)", { inputMode: "decimal" }, true)}
              {input("net_commission", "Net commission after WHT (₦)", { inputMode: "decimal" }, true)}
              {input("commission_given", "Commission given to the customer (₦)", { inputMode: "decimal" }, true)}
              <div className="sm:col-span-3 grid gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs sm:grid-cols-2">
                <span>
                  <span className="text-muted-foreground">Balance commission for the company: </span>
                  <span className={cn("tabular-nums font-medium", balanceCommission !== null && balanceCommission < 0 && "text-destructive-text")}>
                    {balanceCommission === null ? "—" : naira(balanceCommission)}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Cost price (published fare − commission given): </span>
                  <span className="tabular-nums font-medium">{costFromDiscount === null ? "—" : naira(costFromDiscount)}</span>
                </span>
              </div>
            </div>
          ) : null}
        </Card>

        <Section title="Pricing">
          {input("selling_price", "Selling price (₦)", { inputMode: "decimal" }, true)}
          {discountShown ? (
            <div className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                Cost price (₦) <Lock className="size-3 text-muted-foreground" aria-label="Worked out from the discount" />
              </span>
              <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm tabular-nums">
                {costFromDiscount === null ? "From the discount section" : naira(costFromDiscount)}
              </p>
              <FieldError id="ticket-cost-error" message={errors.cost_price} />
            </div>
          ) : (
            input("cost_price", "Cost price (₦)", { inputMode: "decimal" }, true)
          )}

          <div className="sm:col-span-2 space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium">
                Amount in another currency
                {foreignClient ? <span className="text-destructive-text"> *</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {foreignClient
                  ? `${client.name} is billed in ${client.currency}: this is what comes off its balance.`
                  : "Only if the client pays in another currency."}
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-foreign_currency">Currency</Label>
                {foreignClient ? (
                  <p className="flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm">
                    {client.currency}
                  </p>
                ) : (
                  <Select value={values.foreign_currency || "none"} onValueChange={(value) => set("foreign_currency", value === "none" ? "" : value)}>
                    <SelectTrigger id="ticket-foreign_currency" className="w-full" aria-invalid={Boolean(errors.foreign_currency)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {FOREIGN_CURRENCIES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <FieldError id="ticket-foreign_currency-error" message={errors.foreign_currency} />
              </div>
              {input("foreign_amount", `Amount${foreignCurrency ? ` (${foreignCurrency})` : ""}`, { inputMode: "decimal" }, foreignClient)}
              {input("exchange_rate", `Rate (₦ per ${foreignCurrency || "unit"})`, { inputMode: "decimal" }, foreignClient)}
            </div>
            {converted !== null ? (
              <p className={cn("text-xs", coverageShort ? "text-destructive-text" : "text-muted-foreground")}>
                {foreignCurrency || ""} {foreignAmount?.toLocaleString("en-NG")} × {rate?.toLocaleString("en-NG")} = {naira(converted)}
                {coverageShort && selling !== null ? `, less than the selling price of ${naira(selling)}.` : ""}
              </p>
            ) : null}
          </div>
        </Section>

        {paymentType === "cash" ? (
          <Section title="Payment" description="Cash requests are paid in full before they are submitted.">
            {input("amount_paid", "Amount received from the client (₦)", { inputMode: "decimal" }, true)}
            <div className="space-y-1.5">
              <span className="text-sm font-medium">
                Payment evidence<span className="text-destructive-text"> *</span>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept={EVIDENCE_ACCEPT}
                className="sr-only"
                id="ticket-evidence"
                aria-label="Payment evidence"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void chooseEvidence(file);
                }}
              />
              {values.evidence ? (
                <div className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{values.evidence.file_name}</span>
                  <button
                    type="button"
                    aria-label="Remove payment evidence"
                    onClick={() => set("evidence", null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  aria-invalid={Boolean(errors.evidence)}
                >
                  {uploading ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Upload className="mr-1.5 size-4" />}
                  {uploading ? "Uploading…" : "Upload an image or PDF"}
                </Button>
              )}
              <FieldError id="ticket-evidence-error" message={errors.evidence} />
              {paidShort ? <p className="text-xs text-destructive-text">Less than the selling price.</p> : null}
            </div>
          </Section>
        ) : null}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-4">
        <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-sm font-semibold text-foreground">Summary</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Selling price</dt>
              <dd className="tabular-nums">{selling === null ? "—" : naira(selling)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Cost price</dt>
              <dd className="tabular-nums">{cost === null ? "—" : naira(cost)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
              <dt>Revenue</dt>
              <dd className={cn("tabular-nums", revenue !== null && revenue < 0 && "text-destructive-text")}>
                {revenue === null ? "—" : naira(revenue)}
              </dd>
            </div>
          </dl>
          {revenue !== null && revenue < 0 ? (
            <p className="mt-2 text-xs text-destructive-text">The selling price is below the cost price.</p>
          ) : revenue === 0 ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">No profit on this transaction: you will be asked to confirm.</p>
          ) : null}
        </Card>

        {credit ? (
          <Card
            className={cn(
              "gap-0 rounded-xl border bg-card p-5 shadow-xs",
              needsApproval ? "border-amber-500/50 bg-amber-500/5" : "border-border",
            )}
          >
            <h2 className="text-sm font-semibold text-foreground">Credit status</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Approved credit limit</dt>
                <dd className="tabular-nums">{formatMoney(client.credit_limit, client.currency)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Current utilization</dt>
                <dd className="tabular-nums">{formatMoney(client.credit_utilization, client.currency)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Available balance</dt>
                <dd className="tabular-nums">{formatMoney(client.available_balance, client.currency)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Requested amount</dt>
                <dd className="tabular-nums">{requested === null ? "—" : formatMoney(requested, client.currency)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                <dt>Balance after request</dt>
                <dd className={cn("tabular-nums", needsApproval && "text-destructive-text")}>
                  {balanceAfter === null ? "—" : formatMoney(balanceAfter, client.currency)}
                </dd>
              </div>
            </dl>
            {needsApproval ? (
              <p className="mt-3 flex gap-2 text-xs text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                This takes {client.name} over its credit limit, so it will need approval before the ticket is issued.
              </p>
            ) : null}
          </Card>
        ) : null}

        {errors.form ? (
          <p role="alert" className="text-sm text-destructive-text">
            {errors.form}
          </p>
        ) : null}
        {Object.keys(errors).some((key) => key !== "form") ? (
          <p role="alert" className="text-sm text-destructive-text">
            Some fields need attention. They are marked in red.
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
            Back
          </Button>
          <Button
            type="submit"
            disabled={submitting || uploading}
            className="flex-1 bg-[#0d47a1] hover:bg-[#0a3880] text-white"
          >
            {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {needsApproval ? "Submit for approval" : "Submit request"}
          </Button>
        </div>
      </aside>

      <Dialog open={confirmZero} onOpenChange={(open) => !submitting && setConfirmZero(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No profit on this transaction</DialogTitle>
            <DialogDescription>
              The selling price equals the cost price, so the revenue is ₦0.00. Submit the request anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmZero(false)} disabled={submitting}>
              Go back
            </Button>
            <Button
              onClick={async () => {
                await send(true);
                setConfirmZero(false);
              }}
              disabled={submitting}
              className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
            >
              {submitting ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              Submit anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}
