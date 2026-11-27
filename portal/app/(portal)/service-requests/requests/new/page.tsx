"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Banknote, Briefcase, ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { CreditClientPicker } from "@/components/service-requests/credit-client-picker";
import { EMPTY_TICKET, TicketForm, valuesFromRequest, type TicketFormValues } from "@/components/service-requests/ticket-form";
import { PageErrorCard } from "@/components/page-error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchClient, formatMoney, type CreditClient } from "@/lib/api/clients";
import { fetchRequest, type PaymentType } from "@/lib/api/service-requests";
import { extractApiErrorMessage } from "@/lib/api-errors";

type Step = "type" | "client" | "form";

function PaymentChoice({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Banknote;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card p-5 text-left shadow-xs transition-colors hover:border-[#0d47a1]/50 hover:bg-[#0d47a1]/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </button>
  );
}

function NewRequest() {
  const router = useRouter();
  const params = useSearchParams();
  const fromId = params.get("from");
  const [step, setStep] = useState<Step>(fromId ? "form" : "type");
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [client, setClient] = useState<CreditClient | null>(null);
  const [initial, setInitial] = useState<TicketFormValues>(EMPTY_TICKET);
  const [loadingCopy, setLoadingCopy] = useState(Boolean(fromId));
  const [copyError, setCopyError] = useState("");

  // "New request from this one": fill the form from the cancelled request.
  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    async function load(id: string) {
      try {
        const source = await fetchRequest(id);
        const sourceClient = source.payment_type === "credit" && source.client_id ? await fetchClient(source.client_id) : null;
        if (cancelled) return;
        setPaymentType(source.payment_type);
        setClient(sourceClient);
        setInitial(valuesFromRequest(source));
      } catch (error) {
        if (!cancelled) setCopyError(extractApiErrorMessage(error, "The earlier request could not be loaded."));
      } finally {
        if (!cancelled) setLoadingCopy(false);
      }
    }
    void load(fromId);
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  const heading =
    step === "type" ? "New ticket request" : step === "client" ? "Choose the credit client" : "Ticket details";
  const intro =
    step === "type"
      ? "Is the client paying now, or taking the ticket on credit?"
      : step === "client"
        ? "Only active credit clients are listed. Their available balance is what they can still use."
        : paymentType === "cash"
          ? "Cash request: payment evidence and the amount paid are required."
          : `Credit request for ${client?.name ?? "the client"}.`;

  if (copyError) {
    return <PageErrorCard title="Cannot copy that request" message={copyError} onRetry={() => router.refresh()} />;
  }

  return (
    <div className="space-y-6 max-w-full">
      <Link
        href="/service-requests/requests"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        All requests
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{intro}</p>
        {fromId && step === "form" ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Copied from an earlier request. Change what was wrong and submit.
          </p>
        ) : null}
      </div>

      {step === "type" ? (
        <div className="grid gap-3 md:grid-cols-2 max-w-4xl">
          <PaymentChoice
            icon={Banknote}
            title="Cash"
            description="Paid in full. You will attach the payment evidence."
            onClick={() => {
              setPaymentType("cash");
              setClient(null);
              setStep("form");
            }}
          />
          <PaymentChoice
            icon={Briefcase}
            title="Credit"
            description="On a credit client's account. Choose the client next."
            onClick={() => {
              setPaymentType("credit");
              setStep("client");
            }}
          />
        </div>
      ) : null}

      {step === "client" ? (
        <CreditClientPicker
          onPick={(picked) => {
            setClient(picked);
            setStep("form");
            if (Number(picked.available_balance) <= 0) {
              toast.warning(
                `${picked.name} has ${formatMoney(picked.available_balance, picked.currency)} available: this request will need approval.`,
              );
            }
          }}
        />
      ) : null}

      {step === "form" ? (
        loadingCopy ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-56 rounded-xl" />
          </div>
        ) : (
          <TicketForm
            key={`${paymentType}-${client?.id ?? "cash"}`}
            paymentType={paymentType}
            client={client}
            initial={initial}
            createdFrom={fromId}
            onBack={() => setStep(paymentType === "credit" && !fromId ? "client" : "type")}
            onSubmitted={(created) => {
              toast.success(
                created.status === "pending_approval"
                  ? `${created.reference} sent for approval.`
                  : `${created.reference} submitted.`,
              );
              router.push(`/service-requests/requests/${created.id}`);
            }}
          />
        )
      ) : null}
    </div>
  );
}

export default function NewRequestPage() {
  // useSearchParams needs a Suspense boundary in the App Router.
  return (
    <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
      <NewRequest />
    </Suspense>
  );
}
