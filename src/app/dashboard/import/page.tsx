"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { api, errorText, useApi } from "@/lib/client-api";
import { canWrite, useSession } from "@/components/session";
import { Button, Empty, ErrorNote, Field, Loading, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { useToast } from "@/components/toast";

type Result = {
  filename: string; rowsTotal: number; imported: number; duplicates: number; rejected: number; credits: number;
  mapping: Record<string, string>; rejectedRows: { line: number; reason: string }[];
  analysis: { detections: number; created: number; removed: number; newHigh: unknown[]; skipped: { ruleId: string; ruleName: string; reason: string }[] };
};
type ImportRow = { id: string; filename: string; rows_total: number; rows_imported: number; rows_duplicate: number; rows_rejected: number; created_by: string; created_at: string };

const FIELD_LABEL: Record<string, string> = {
  date: "Date", merchant: "Merchant", amount: "Amount", debit: "Debit", credit: "Credit", type: "Type", employee: "Employee",
  department: "Department", category: "Category", invoice: "Invoice no.", gstin: "Vendor GSTIN", reference: "Reference",
};

export default function ImportPage() {
  const session = useSession();
  const toast = useToast();
  const history = useApi<ImportRow[]>("/api/imports");
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dateOrder, setDateOrder] = useState("dmy");
  const [negatives, setNegatives] = useState("refund");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const writer = canWrite(session.user.role);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("dateOrder", dateOrder); fd.append("negatives", negatives);
    try {
      const r = await api<Result>("/api/imports", { method: "POST", body: fd });
      setResult(r); setFile(null); if (input.current) input.current.value = ""; history.reload();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  const remove = async (row: ImportRow) => {
    if (!confirm(`Remove ${row.filename} and its ${row.rows_imported} transactions? Open findings that depend on them will be cleared. This is recorded in the audit log.`)) return;
    try { await api(`/api/imports/${row.id}`, { method: "DELETE" }); toast("Import removed."); history.reload(); }
    catch (err) { toast(errorText(err), "error"); }
  };

  return (
    <>
      <PageHeader title="Import" sub="Upload a bank, card or expense statement as CSV, Excel (.xlsx), or a text-based PDF. Every row is checked against your policies straight away." />

      {writer ? (
        <form onSubmit={upload} className="max-w-2xl space-y-4 rounded-lg border border-line bg-surface p-5">
          <Field label="Statement file" hint="CSV, .xlsx, or text-based PDF, up to 5 MB and 20,000 rows. Columns are recognised automatically. Scanned PDFs need to be exported with selectable text.">
            <input ref={input} type="file" accept=".csv,.xlsx,.pdf,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-soft file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date format" hint="Decides what 03/04/2026 means.">
              <Select value={dateOrder} onChange={(e) => setDateOrder(e.target.value)}>
                <option value="dmy">Day first: 3 April (India)</option>
                <option value="mdy">Month first: 4 March (US)</option>
              </Select>
            </Field>
            <Field label="Negative amounts are" hint="Only matters for a single signed Amount column.">
              <Select value={negatives} onChange={(e) => setNegatives(e.target.value)}>
                <option value="refund">Refunds or credits (cards, expense reports)</option>
                <option value="out">Payments going out (bank statements)</option>
              </Select>
            </Field>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!file || busy}>{busy ? "Importing and checking…" : "Import and check"}</Button>
            <a href="/sample/expenses-q2-fy27.csv" download className="text-sm text-brand underline underline-offset-2">Download a sample statement</a>
          </div>
        </form>
      ) : <ErrorNote>Your role is read-only, so you can’t import statements.</ErrorNote>}

      {result && (
        <section className="mt-6 max-w-3xl space-y-4" aria-label="Import result">
          <div className="rounded-lg border border-ok/30 bg-ok-bg p-5">
            <p className="font-semibold text-ok">Imported {result.imported} transactions from {result.filename}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {result.duplicates > 0 && <li>{result.duplicates} rows were already on file and were skipped, so nothing is double counted.</li>}
              {result.credits > 0 && <li>{result.credits} refund or credit row{result.credits === 1 ? "" : "s"} recorded but excluded from spend.</li>}
              {result.rejected > 0 && <li>{result.rejected} row{result.rejected === 1 ? "" : "s"} could not be read (listed below).</li>}
              <li>Policy check: {result.analysis.created} new finding{result.analysis.created === 1 ? "" : "s"}{result.analysis.newHigh.length ? `, ${result.analysis.newHigh.length} high severity` : ""}.{" "}
                <Link href="/dashboard/findings" className="font-medium underline underline-offset-2">Review findings</Link></li>
            </ul>
          </div>
          {result.analysis.skipped.length > 0 && (
            <div className="rounded-md border border-med/30 bg-med-bg px-4 py-3 text-sm text-med">
              <p className="font-medium">Some rules couldn’t run on this file</p>
              <ul className="mt-1 list-disc pl-5">{result.analysis.skipped.map((k) => <li key={k.ruleId}><strong>{k.ruleName}:</strong> {k.reason}</li>)}</ul>
            </div>
          )}
          <div>
            <h2 className="mb-2 text-sm font-semibold">How we read your columns</h2>
            <p className="text-sm text-muted">{Object.entries(result.mapping).map(([k, v]) => `${FIELD_LABEL[k] ?? k} ← “${v}”`).join("  ·  ")}</p>
          </div>
          {result.rejectedRows.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold">Rows that were not imported</h2>
              <Table><thead><tr><Th>File row</Th><Th>Reason</Th></tr></thead>
                <tbody>{result.rejectedRows.map((r) => <tr key={r.line}><Td mono>{r.line}</Td><Td>{r.reason}</Td></tr>)}</tbody></Table>
              <p className="mt-2 text-xs text-muted">Fix these in the file and import again. Rows already on file are skipped automatically.</p>
            </div>
          )}
        </section>
      )}

      <h2 className="mb-3 mt-10 font-semibold">Import history</h2>
      {history.loading ? <Loading /> : !history.data?.length ? <Empty title="Nothing imported yet" /> : (
        <Table>
          <thead><tr><Th>File</Th><Th>When</Th><Th>By</Th><Th right>Imported</Th><Th right>Skipped</Th><Th right>Rejected</Th><Th /></tr></thead>
          <tbody>
            {history.data.map((r) => (
              <tr key={r.id}>
                <Td>{r.filename}</Td><Td className="whitespace-nowrap tabular-nums">{new Date(r.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Td>
                <Td>{r.created_by}</Td><Td right>{r.rows_imported}</Td><Td right>{r.rows_duplicate}</Td><Td right>{r.rows_rejected}</Td>
                <Td right>{session.user.role === "admin" && <Button variant="ghost" small onClick={() => remove(r)}>Remove</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
