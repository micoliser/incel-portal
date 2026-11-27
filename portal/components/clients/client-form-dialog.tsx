"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CURRENCIES,
  createClient,
  fieldErrors,
  formatMoney,
  updateClient,
  type ClientFormValues,
  type CreditClient,
} from "@/lib/api/clients";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const EMPTY: ClientFormValues = {
  name: "",
  tin: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  credit_limit: "",
  credit_days: "",
  credit_utilization: "0",
  currency: "NGN",
  status: "active",
  notes: "",
};

function valuesFrom(client: CreditClient | null): ClientFormValues {
  if (!client) return EMPTY;
  return {
    name: client.name,
    tin: client.tin,
    contact_person: client.contact_person,
    phone: client.phone,
    email: client.email,
    address: client.address,
    credit_limit: client.credit_limit,
    credit_days: String(client.credit_days),
    credit_utilization: client.credit_utilization,
    currency: client.currency,
    status: client.status,
    notes: client.notes,
  };
}

/** Quick checks before sending; the server applies the full rules and its messages win. */
function checkLocally(values: ClientFormValues) {
  const errors: Record<string, string> = {};
  if (!values.name.trim()) errors.name = "Name is required.";
  if (!values.tin.trim()) errors.tin = "TIN is required.";
  if (!values.contact_person.trim()) errors.contact_person = "Contact person is required.";
  if (!values.phone.trim()) errors.phone = "Phone is required.";
  if (!values.email.trim()) errors.email = "Email is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) errors.email = "Email must be a valid email address.";
  if (!values.credit_limit.trim()) errors.credit_limit = "Credit limit is required.";
  else if (!(Number(values.credit_limit.replace(/,/g, "")) > 0)) errors.credit_limit = "Credit limit must be more than 0.";
  if (!values.credit_days.trim()) errors.credit_days = "Credit days is required.";
  else if (!/^\d+$/.test(values.credit_days.trim())) errors.credit_days = "Credit days must be a whole number of days.";
  return errors;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client to edit, or null to add one. */
  client: CreditClient | null;
  onSaved: (client: CreditClient) => void;
};

export function ClientFormDialog({ open, onOpenChange, client, onSaved }: Props) {
  const [values, setValues] = useState<ClientFormValues>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(valuesFrom(client));
      setErrors({});
    }
  }, [open, client]);

  const set = (field: keyof ClientFormValues) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const limit = Number(values.credit_limit.replace(/,/g, ""));
  const used = Number(values.credit_utilization.replace(/,/g, "") || 0);
  const balance = Number.isFinite(limit) && Number.isFinite(used) ? limit - used : NaN;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const local = checkLocally(values);
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    setSaving(true);
    try {
      let payload: Partial<ClientFormValues> = values;
      if (client) {
        // Send only what changed, so the history shows exactly that.
        const before = valuesFrom(client);
        payload = Object.fromEntries(
          Object.entries(values).filter(([key, value]) => before[key as keyof ClientFormValues] !== value),
        );
        if (!Object.keys(payload).length) {
          onOpenChange(false);
          return;
        }
      }
      const saved = client ? await updateClient(client.id, payload) : await createClient(payload);
      toast.success(client ? "Client updated." : "Client added.");
      onSaved(saved);
      onOpenChange(false);
    } catch (error) {
      const byField = fieldErrors(error);
      if (Object.keys(byField).length) setErrors(byField);
      else toast.error(extractApiErrorMessage(error, "The client could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  const field = (
    name: keyof ClientFormValues,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    required = false,
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`client-${name}`}>
        <span>
          {label}
          {required ? <span className="text-destructive-text"> *</span> : null}
        </span>
      </Label>
      <Input
        id={`client-${name}`}
        value={values[name]}
        onChange={(event) => set(name)(event.target.value)}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `client-${name}-error` : undefined}
        className={cn(errors[name] && "border-destructive")}
        {...props}
      />
      {errors[name] ? (
        <p id={`client-${name}-error`} className="text-xs text-destructive-text">
          {errors[name]}
        </p>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{client ? `Edit ${client.name}` : "Add credit client"}</DialogTitle>
            <DialogDescription>
              {client
                ? "Changes are recorded in the client's history with your name."
                : "Fields marked * are required. Available balance is calculated for you."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field("name", "Name", { maxLength: 200, autoFocus: true }, true)}</div>
            {field("tin", "TIN", { maxLength: 20, inputMode: "numeric", placeholder: "12345678-0001" }, true)}
            {field("contact_person", "Contact person", { maxLength: 150 }, true)}
            {field("phone", "Phone", { maxLength: 30, type: "tel", placeholder: "+234 803 123 4567" }, true)}
            {field("email", "Email", { maxLength: 254, type: "email" }, true)}
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="client-address">Address</Label>
              <Textarea
                id="client-address"
                value={values.address}
                maxLength={500}
                rows={2}
                onChange={(event) => set("address")(event.target.value)}
                aria-invalid={Boolean(errors.address)}
              />
              {errors.address ? <p className="text-xs text-destructive-text">{errors.address}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-currency">Currency</Label>
              <Select value={values.currency} onValueChange={set("currency")}>
                <SelectTrigger id="client-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.currency ? <p className="text-xs text-destructive-text">{errors.currency}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status">Status</Label>
              <Select value={values.status} onValueChange={set("status")}>
                <SelectTrigger id="client-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {field("credit_limit", "Credit limit", { inputMode: "decimal", placeholder: "1500000.00" }, true)}
            {field("credit_days", "Credit days", { inputMode: "numeric", placeholder: "30" }, true)}
            {field("credit_utilization", "Credit utilization", { inputMode: "decimal" })}
            <div className="space-y-1.5">
              <span className="text-sm font-medium leading-none">Available balance</span>
              <p
                className={cn(
                  "flex h-9 items-center rounded-md border border-dashed border-border px-3 text-sm tabular-nums",
                  balance < 0 ? "text-destructive-text" : "text-muted-foreground",
                )}
                aria-live="polite"
              >
                {Number.isFinite(balance) ? formatMoney(balance, values.currency) : "—"}
              </p>
              {balance < 0 ? (
                <p className="text-xs text-destructive-text">Utilization is above the limit.</p>
              ) : null}
            </div>

            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="client-notes">Notes</Label>
              <Textarea
                id="client-notes"
                value={values.notes}
                maxLength={2000}
                rows={3}
                onChange={(event) => set("notes")(event.target.value)}
              />
              {errors.notes ? <p className="text-xs text-destructive-text">{errors.notes}</p> : null}
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="bg-[#0d47a1] hover:bg-[#0a3880] text-white">
              {saving ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
              {client ? "Save changes" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
