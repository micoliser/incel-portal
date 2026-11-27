"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  FIELD_LABELS,
  confirmImport,
  downloadImportTemplate,
  fetchClientImports,
  formatMoney,
  previewImport,
  type ClientFormValues,
  type ClientImportRecord,
  type DuplicateGroup,
  type ImportDecisions,
  type ImportPreview,
  type ImportRowValues,
} from "@/lib/api/clients";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

const COMPARE_FIELDS: (keyof ClientFormValues)[] = [
  "name",
  "tin",
  "contact_person",
  "phone",
  "email",
  "address",
  "credit_limit",
  "credit_days",
  "credit_utilization",
  "currency",
  "status",
  "notes",
];
const PREVIEW_LIMIT = 50;

function show(field: keyof ClientFormValues, values: ImportRowValues | undefined, currency?: string) {
  if (!values || !(field in values)) return null;
  const value = values[field];
  if (value === "" || value === undefined || value === null) return "";
  if (field === "credit_limit" || field === "credit_utilization") return formatMoney(value, currency ?? "NGN");
  if (field === "status") return value === "active" ? "Active" : "Inactive";
  return String(value);
}

function Duplicate({
  group,
  decision,
  onDecide,
}: {
  group: DuplicateGroup;
  decision: ImportDecisions[string] | undefined;
  onDecide: (value: ImportDecisions[string]) => void;
}) {
  const fields = COMPARE_FIELDS.filter(
    (field) => group.rows.some((row) => field in row.values) || (group.existing && field in group.existing.values),
  );
  const columns = [
    ...(group.existing ? [{ key: "existing", label: "Existing client", values: group.existing.values }] : []),
    ...group.rows.map((row) => ({ key: `row-${row.row}`, label: `Row ${row.row}`, values: row.values })),
  ];
  const name = `decision-${group.id}`;
  const options: { value: ImportDecisions[string]; label: string }[] = [
    ...group.rows.map((row) => ({
      value: row.row,
      label: group.existing ? `Update the existing client with row ${row.row}` : `Import row ${row.row}`,
    })),
    {
      value: "reject",
      label: group.existing
        ? `Reject ${group.rows.length === 1 ? "this row" : "these rows"} and keep the existing client as it is`
        : "Reject all of these rows",
    },
  ];

  return (
    <Card className={cn("gap-0 rounded-xl border bg-card p-4 shadow-xs", decision === undefined ? "border-amber-500/40" : "border-border")}>
      <p className="text-sm font-medium text-foreground">{group.reason}</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Field</th>
              {columns.map((column) => (
                <th key={column.key} className="py-2 pr-3 font-medium">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {fields.map((field) => {
              const currency = (values: ImportRowValues) => String(values.currency ?? group.existing?.values.currency ?? "NGN");
              const shown = columns.map((column) => show(field, column.values, currency(column.values)));
              const differs = new Set(shown.filter((value) => value !== null)).size > 1;
              return (
                <tr key={field}>
                  <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{FIELD_LABELS[field]}</td>
                  {shown.map((value, index) => (
                    <td
                      key={columns[index].key}
                      className={cn("py-1.5 pr-3 break-words", differs && value !== null && "font-semibold text-foreground")}
                    >
                      {value === null ? (
                        <span className="text-muted-foreground italic">not in file</span>
                      ) : value === "" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        value
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <fieldset className="mt-3 space-y-1.5">
        <legend className="sr-only">What to do with this duplicate</legend>
        {options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name={name}
              checked={decision === option.value}
              onChange={() => onDecide(option.value)}
              className="size-4 accent-[#0d47a1]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </Card>
  );
}

export default function ClientImportPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileError, setFileError] = useState("");
  const [decisions, setDecisions] = useState<ImportDecisions>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [done, setDone] = useState<ClientImportRecord | null>(null);
  const [imports, setImports] = useState<ClientImportRecord[]>([]);
  const [importsKey, setImportsKey] = useState(0);

  useEffect(() => {
    fetchClientImports()
      .then((data) => setImports(data.results))
      .catch(() => undefined);
  }, [importsKey]);

  function reset() {
    setFile(null);
    setPreview(null);
    setFileError("");
    setDecisions({});
    setAcknowledged(false);
    setDone(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function check(chosen: File) {
    setFile(chosen);
    setPreview(null);
    setFileError("");
    setDecisions({});
    setAcknowledged(false);
    setDone(null);
    setChecking(true);
    try {
      setPreview(await previewImport(chosen));
    } catch (error) {
      setFileError(extractApiErrorMessage(error, "The file could not be checked."));
    } finally {
      setChecking(false);
    }
  }

  async function handleTemplate() {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "credit-clients-template.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "The template could not be downloaded."));
    }
  }

  const undecided = useMemo(
    () => (preview?.duplicates ?? []).filter((group) => decisions[group.id] === undefined).length,
    [preview, decisions],
  );
  const needsAcknowledgement = Boolean(preview?.notices.length);
  const toImport = useMemo(() => {
    if (!preview) return { created: 0, updated: 0, rejected: 0 };
    let created = preview.summary.new;
    let updated = 0;
    let rejected = 0;
    for (const group of preview.duplicates) {
      const decision = decisions[group.id];
      if (decision === undefined) continue;
      if (decision === "reject") {
        rejected += group.rows.length;
        continue;
      }
      if (group.existing) updated += 1;
      else created += 1;
      rejected += group.rows.length - 1;
    }
    return { created, updated, rejected };
  }, [preview, decisions]);

  async function handleConfirm() {
    if (!file || !preview) return;
    setImporting(true);
    try {
      const record = await confirmImport(file, decisions);
      setDone(record);
      setPreview(null);
      setImportsKey((key) => key + 1);
      toast.success("Clients imported.");
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "The import did not go through. Nothing was saved."));
    } finally {
      setImporting(false);
    }
  }

  const hasErrors = preview && !preview.can_import;
  const rowsShown = preview?.rows.slice(0, PREVIEW_LIMIT) ?? [];

  return (
    <div className="space-y-6 max-w-full">
      <Link href="/service-requests/clients" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All clients
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Import credit clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is saved until you have reviewed the file and confirmed. If anything fails, nothing is imported.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleTemplate} className="rounded-lg h-9.5">
          <Download className="mr-1.5 size-4" />
          Download template
        </Button>
      </div>

      {/* Step 1: choose a file */}
      <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8]">
            <FileSpreadsheet className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">{file ? file.name : "Choose an Excel (.xlsx) or CSV file"}</p>
            <p className="text-xs text-muted-foreground">
              Required columns: Name, TIN, Contact Person, Phone, Email, Credit Limit, Credit Days. Column names must match the template; capitals,
              spaces, underscores and hyphens don&apos;t matter.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            id="client-import-file"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (chosen) void check(chosen);
            }}
          />
          <Button
            onClick={() => inputRef.current?.click()}
            disabled={checking || importing}
            className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg"
          >
            {checking ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : <Upload className="mr-1.5 size-4" />}
            {checking ? "Checking…" : file ? "Choose another file" : "Choose file"}
          </Button>
        </div>
        {fileError ? (
          <p role="alert" className="mt-4 flex items-start gap-2 text-sm text-destructive-text">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {fileError}
          </p>
        ) : null}
      </Card>

      {done ? (
        <Card className="gap-0 rounded-xl border border-[#16a34a]/30 bg-[#16a34a]/5 p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-text" aria-hidden="true" />
            <div>
              <p className="font-semibold text-foreground">Import complete</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {done.created_count} added, {done.updated_count} updated, {done.rejected_count} rejected from{" "}
                {done.file_name}.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" asChild className="bg-[#0d47a1] hover:bg-[#0a3880] text-white">
                  <Link href="/service-requests/clients">View clients</Link>
                </Button>
                <Button size="sm" variant="outline" onClick={reset}>
                  Import another file
                </Button>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Steps 1 and 2 failed: what to fix */}
      {hasErrors ? (
        <Card role="alert" className="gap-0 rounded-xl border border-[#dc2626]/30 bg-card p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <XCircle className="mt-0.5 size-5 shrink-0 text-destructive-text" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">This file can&apos;t be imported yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Correct {preview.column_errors.length ? "the columns" : "these rows"} in the spreadsheet and choose it
                again. Nothing has been saved.
              </p>
              {preview.column_errors.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-destructive-text">
                  {preview.column_errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Column</th>
                        <th className="px-3 py-2 font-medium">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.row_errors.map((error, index) => (
                        <tr key={`${error.row}-${error.field}-${index}`}>
                          <td className="px-3 py-2 tabular-nums">{error.row}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{error.column}</td>
                          <td className="px-3 py-2 text-destructive-text">{error.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {preview.row_errors.length
                  ? `${preview.row_errors.length} problem${preview.row_errors.length === 1 ? "" : "s"} found.`
                  : null}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Step 3: review */}
      {preview && preview.can_import ? (
        <>
          <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
            <p className="font-semibold text-foreground">The file passed every check</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {preview.summary.rows} {preview.summary.rows === 1 ? "client" : "clients"} in the file:{" "}
              {preview.summary.new} new
              {preview.summary.duplicate_groups
                ? `, ${preview.summary.duplicate_groups} duplicate${preview.summary.duplicate_groups === 1 ? "" : "s"} to decide`
                : ""}
              .
            </p>
          </Card>

          {preview.notices.length ? (
            <Card className="gap-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 shadow-xs">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Info className="size-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
                Please confirm
              </h2>
              <ul className="mt-3 space-y-2.5 text-sm text-foreground">
                {preview.notices.map((notice) => (
                  <li key={notice.code}>
                    {notice.message}
                    {notice.rows?.length ? (
                      <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {notice.rows.slice(0, 10).map((row) => (
                          <li key={row.row}>
                            Row {row.row}: {row.name}, available balance{" "}
                            <span className="text-destructive-text tabular-nums">
                              {formatMoney(row.available_balance, row.currency)}
                            </span>
                          </li>
                        ))}
                        {notice.rows.length > 10 ? <li>and {notice.rows.length - 10} more</li> : null}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
              <label className="mt-4 flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  className="size-4 accent-[#0d47a1]"
                />
                I have read these and want to continue
              </label>
            </Card>
          ) : null}

          {preview.duplicates.length ? (
            <section className="space-y-3" aria-labelledby="duplicates-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="duplicates-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
                  Duplicates ({preview.duplicates.length})
                </h2>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDecisions(Object.fromEntries(preview.duplicates.map((group) => [group.id, "reject" as const])))
                    }
                  >
                    Reject all
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Choose for each one. Columns that are not in the file keep the existing client&apos;s values when
                updating.
              </p>
              {preview.duplicates.map((group) => (
                <Duplicate
                  key={group.id}
                  group={group}
                  decision={decisions[group.id]}
                  onDecide={(value) => setDecisions((current) => ({ ...current, [group.id]: value }))}
                />
              ))}
            </section>
          ) : null}

          <Card className="gap-0 py-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              Clients in the file
              {preview.rows.length > PREVIEW_LIMIT ? ` (first ${PREVIEW_LIMIT} of ${preview.rows.length})` : ""}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Row</th>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">TIN</th>
                    <th className="px-4 py-2 font-medium text-right">Credit limit</th>
                    <th className="px-4 py-2 font-medium text-right">Utilization</th>
                    <th className="px-4 py-2 font-medium text-right">Credit days</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rowsShown.map(({ row, values, duplicate_group }) => {
                    const currency = String(values.currency ?? "NGN");
                    return (
                      <tr key={row}>
                        <td className="px-4 py-2 tabular-nums text-muted-foreground">{row}</td>
                        <td className="px-4 py-2 max-w-[240px] truncate">{values.name}</td>
                        <td className="px-4 py-2 font-mono text-xs">{values.tin}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatMoney(values.credit_limit, currency)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                          {"credit_utilization" in values ? formatMoney(values.credit_utilization, currency) : "—"}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{values.credit_days}</td>
                        <td className="px-4 py-2">
                          {duplicate_group ? <Badge variant="warning">Duplicate</Badge> : <Badge variant="secondary">New</Badge>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Step 4: confirm or cancel */}
          <Card className="gap-0 sticky bottom-20 z-10 rounded-xl border border-border bg-card p-4 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {undecided
                  ? `${undecided} duplicate${undecided === 1 ? "" : "s"} still need${undecided === 1 ? "s" : ""} a decision.`
                  : needsAcknowledgement && !acknowledged
                    ? "Tick the box above to confirm the notices."
                    : `${toImport.created} will be added, ${toImport.updated} updated and ${toImport.rejected} rejected.`}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset} disabled={importing}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={importing || undecided > 0 || (needsAcknowledgement && !acknowledged)}
                  className="bg-[#0d47a1] hover:bg-[#0a3880] text-white"
                >
                  {importing ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
                  Confirm import
                </Button>
              </div>
            </div>
          </Card>
        </>
      ) : null}

      {imports.length ? (
        <Card className="gap-0 rounded-xl border border-border bg-card p-5 shadow-xs">
          <h2 className="text-sm font-semibold text-foreground">Recent imports</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {imports.slice(0, 10).map((record) => (
              <li key={record.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2.5">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-foreground">{record.file_name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    by {record.uploaded_by?.full_name ?? "someone"} ·{" "}
                    {new Date(record.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {record.created_count} added · {record.updated_count} updated · {record.rejected_count} rejected
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
